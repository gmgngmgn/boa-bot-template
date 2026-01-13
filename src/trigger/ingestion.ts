import { task, logger, wait, schedules } from "@trigger.dev/sdk/v3";
import { AssemblyAI } from "assemblyai";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, generateObject } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Initialize Supabase Admin Client
const getSupabaseAdmin = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
};

// --- Types ---

type YoutubeTranscriptPayload = {
  userId: string;
  documentId: string;
  url: string;
};

type TranscribeVideoPayload = {
  userId: string;
  documentId: string;
  storagePath: string;
  filename: string;
};

type ExtractDocumentTextPayload = {
  userId: string;
  documentId: string;
  storagePath: string;
  filename: string;
};

type IngestDocumentPayload = {
  userId: string;
  documentId: string;
  targetTable?: string;
  externalLink?: string;
};

type DeleteDocumentPayload = {
  userId: string;
  documentId: string;
};

// --- Tasks ---

export const youtubeTranscript = task({
  id: "youtube-transcript",
  run: async (payload: YoutubeTranscriptPayload) => {
    const { userId, documentId, url } = payload;
    const apiKey = process.env.SCRAPE_CREATORS_API_KEY || process.env.NEXT_PUBLIC_SCRAPE_CREATORS_API_KEY;

    if (!apiKey) throw new Error("ScrapeCreators API key not configured");

    const dbc = getSupabaseAdmin();

    // Update status
    await dbc.from("uploads").update({
      status: "processing",
      metadata: { progress: 5 },
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);

    try {
      const apiUrl = new URL("https://api.scrapecreators.com/v1/youtube/video/transcript");
      apiUrl.searchParams.set("url", url);

      const res = await fetch(apiUrl.toString(), {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ScrapeCreators error ${res.status}: ${text || res.statusText}`);
      }

      const data = await res.json();
      const transcriptText: string = String(data?.transcript_only_text || "").trim();

      if (!transcriptText) throw new Error("Transcript empty from ScrapeCreators");

      // Save success
      await dbc.from("uploads").update({
        status: "completed",
        transcript_text: transcriptText,
        metadata: { progress: 100 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);

      return { ok: true, documentId, textLength: transcriptText.length };

    } catch (err: any) {
      // Save failure
      await dbc.from("uploads").update({
        status: "error",
        metadata: { error: String(err?.message || err), progress: 0 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);

      throw err;
    }
  },
});

export const transcribeVideo = task({
  id: "transcribe-video",
  run: async (payload: TranscribeVideoPayload) => {
    const { userId, documentId, storagePath, filename } = payload;
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) throw new Error("Missing ASSEMBLYAI_API_KEY env var");

    const client = new AssemblyAI({ apiKey });
    const dbc = getSupabaseAdmin();

    // Update status
    await dbc.from("uploads").update({
      status: "processing",
      metadata: { progress: 5 },
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);

    try {
      // Check if audio file (bypass transcoding)
      const isAudioExt = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(filename);

      let audioUrl = "";

      if (isAudioExt) {
        // Generate signed URL for direct audio
        const { data: signed, error: signErr } = await dbc.storage
          .from('documents')
          .createSignedUrl(storagePath, 60 * 60 * 24 * 3); // 3 days
        
        if (signErr) throw signErr;
        audioUrl = signed.signedUrl;
      } else {
        // Video: extract audio using mediabunny
        const mediabunny = await import("mediabunny");
        const { Conversion, Input, BufferSource, Mp3OutputFormat, BufferTarget, Output, ALL_FORMATS } = mediabunny as any;

        const { data: blob, error: dlErr } = await dbc.storage.from('documents').download(storagePath);
        if (dlErr) throw dlErr;

        const ab = await (blob as Blob).arrayBuffer();
        const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(ab) });

        // Check for decodable audio
        const audioTracks = await input.getAudioTracks().catch(() => []);
        let hasDecodableAudio = false;
        for (const t of audioTracks) {
          try { if (await t.canDecode()) { hasDecodableAudio = true; break; } } catch {}
        }

        if (!hasDecodableAudio) {
          // Fallback: use signed URL of original video
          const { data: signed, error: signErr } = await dbc.storage
            .from('documents')
            .createSignedUrl(storagePath, 60 * 60 * 24 * 3);
          if (signErr) throw signErr;
          audioUrl = signed.signedUrl;
        } else {
          // Transcode to MP3
          const target = new BufferTarget();
          const output = new Output({ format: new Mp3OutputFormat(), target });
          const conversion = await Conversion.init({ input, output, audio: { codec: "mp3", forceTranscode: true } });
          
          if (!conversion.isValid) throw new Error("Invalid conversion configuration");
          await conversion.execute();
          
          const arrayBuffer = target.buffer as ArrayBuffer | null;
          if (!arrayBuffer) throw new Error("MP3 conversion produced empty buffer");
          
          const mp3Bytes = Buffer.from(new Uint8Array(arrayBuffer));
          audioUrl = await client.files.upload(mp3Bytes);
        }
      }

      // Submit to AssemblyAI
      const transcript = await client.transcripts.create({ 
        audio_url: audioUrl, 
        speaker_labels: false 
      });

      // Poll for completion
      let info: any = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        info = await client.transcripts.get(transcript.id);
        if (info.status === 'completed' || info.status === 'error') break;
        
        // Update progress
        const pct = Math.min(95, 10 + attempt);
        await dbc.from("uploads").update({ 
          metadata: { progress: pct },
          updated_at: new Date().toISOString() 
        }).eq("id", documentId);
        
        await wait.for({ seconds: 10 });
      }

      if (!info || (info.status !== 'completed' && info.status !== 'error')) {
        throw new Error('Transcription polling timed out');
      }

      if (info.status === 'error') {
        throw new Error(`AssemblyAI error: ${info.error}`);
      }

      // Save result
      await dbc.from("uploads").update({
        status: "completed",
        transcript_text: info.text,
        metadata: { progress: 100, assemblyai_id: transcript.id },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);

      return { ok: true, documentId, textLength: info.text?.length || 0 };

    } catch (err: any) {
      logger.error("Transcription failed", { documentId, error: err });
      
      await dbc.from("uploads").update({
        status: "error",
        metadata: { error: String(err?.message || err), progress: 0 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);

      throw err;
    }
  },
});

export const extractDocumentText = task({
  id: "extract-document-text",
  run: async (payload: ExtractDocumentTextPayload) => {
    const { userId, documentId, storagePath, filename } = payload;
    const dbc = getSupabaseAdmin();

    try {
      // Update status
      await dbc.from("uploads").update({
        status: "processing",
        metadata: { progress: 10 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);

      // Download from storage
      const buffer = await downloadToBuffer(storagePath, true, dbc);
      const ext = inferExt(filename);
      
      let transcriptText = '';
      
      // Extract text based on file type
      if (ext === 'pdf') {
        const pages = await extractPdfChunks(buffer);
        transcriptText = pages.join('\n\n');
      } else if (ext === 'docx') {
        transcriptText = await extractText(buffer, 'docx');
      } else {
        transcriptText = buffer.toString('utf8');
      }
      
      if (!transcriptText) throw new Error("Extracted text is empty");

      // Save extracted text
      await dbc.from('documents').update({
        transcript_text: transcriptText,
        status: 'completed',
        metadata: { progress: 100 },
        updated_at: new Date().toISOString(),
      }).eq('id', documentId);

      return { ok: true, documentId, textLength: transcriptText.length };

    } catch (err: any) {
      logger.error("Text extraction failed", { documentId, error: err });
      
      await dbc.from("uploads").update({
        status: "error",
        metadata: { error: String(err?.message || err), progress: 0 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);

      throw err;
    }
  },
});

export const ingestDocument = task({
  id: "ingest-document",
  run: async (payload: IngestDocumentPayload) => {
    const { userId, documentId, targetTable = "documents", externalLink } = payload;
    const dbc = getSupabaseAdmin();

    // Get document
    const { data: doc, error: docErr } = await dbc
      .from("uploads")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docErr || !doc) throw new Error("Document not found");
    if (!doc.transcript_text) throw new Error("Document has no transcript text. Please wait for transcription to complete.");

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("Missing OPENAI_API_KEY");

    try {
      // Extract user-defined metadata fields
      let extractedMetadata: Record<string, string> = {};

      const { data: defs } = await dbc
        .from('metadata_fields')
        .select('field_name')
        .eq('user_id', userId)
        .eq('enabled', true);

      const keys = (defs || []).map(d => String(d.field_name)).filter(Boolean);

      if (keys.length > 0) {
        const openai = createOpenAI({ apiKey: openaiKey });
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const k of keys) shape[k] = z.string().optional();
        const schema = z.object(shape);

        const prompt = `Extract fields: ${keys.join(", ")}. Text: ${(doc.transcript_text || "").slice(0, 20000)}`;
        const obj = await generateObject({ model: openai("gpt-4o-mini"), schema, prompt });
        extractedMetadata = (obj.object || {}) as Record<string, string>;
      }

      // Chunk text with indices
      const chunks = chunkTextWithIndices(doc.transcript_text);

      // Generate embeddings
      const openai = createOpenAI({ apiKey: openaiKey });
      const model = openai.embedding('text-embedding-3-small');

      const vectorIds: string[] = [];
      const maxRetries = 3;

      const systemMetadata = {
        ...extractedMetadata,
        document_id: documentId,
        filename: doc.filename,
        source_type: doc.source_type,
        _transcript_id: documentId,
        _source: doc.source_url || null,
        _original_filename: doc.filename,
        ...(externalLink && { link_to_resource: externalLink }),
      };

      for (const chunk of chunks) {
        const content = chunk.content;
        const estimatedTokens = Math.ceil(content.length / 4);
        let embeddingVector: number[] | null = null;
        let embedError: string | null = null;
        let attempts = 0;

        while (attempts < maxRetries && !embeddingVector) {
          attempts += 1;
          try {
            const res = await embed({ model, value: content });
            embeddingVector = res.embedding;
          } catch (err: any) {
            embedError = String(err?.message || err);
            logger.error("Embedding failed for chunk", { error: err, attempt: attempts });
            if (attempts < maxRetries) {
              await wait.for({ seconds: (attempts * 250) / 1000 });
            }
          }
        }

        if (!embeddingVector) continue;

        // Insert into documents (vector table)
        const vectorPayload = {
          content,
          embedding: embeddingVector,
          metadata: {
            ...systemMetadata,
            user_id: userId,
            upload_id: documentId,
            _chunk_index: chunk.index,
            _embedding_status: 'success',
            _embedding_error: embedError,
            _embedding_attempts: attempts,
            _estimated_tokens: estimatedTokens,
          },
        };

        const { data: inserted, error: insErr } = await dbc
          .from(targetTable)
          .insert(vectorPayload)
          .select('id')
          .single();

        if (insErr) {
          logger.error("Failed to insert vector", { error: insErr });
          continue;
        }

        if (inserted?.id) {
          vectorIds.push(inserted.id);
        }
      }

      if (vectorIds.length === 0) {
        throw new Error("No vectors were successfully inserted");
      }

      // Create tracking record (vector_ids are bigint since documents table uses bigint IDs)
      await dbc.from("upload_vectors").insert({
        user_id: userId,
        upload_id: documentId,
        vector_ids: vectorIds.map(id => parseInt(id, 10)),
        chunk_count: vectorIds.length,
        target_table: targetTable,
        external_link: externalLink || null,
      });

      // Update document metadata
      await dbc.from("uploads").update({
        metadata: {
          ...doc.metadata,
          ingested: true,
          vector_count: vectorIds.length,
          ...(externalLink && { external_link: externalLink }),
        },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);

      return {
        ok: true,
        documentId,
        vectorCount: vectorIds.length,
        chunks: chunks.length
      };

    } catch (err: any) {
      logger.error("Ingestion failed", { documentId, error: err });
      throw err;
    }
  },
});

export const deleteDocument = task({
  id: "delete-document",
  run: async (payload: DeleteDocumentPayload) => {
    const { userId, documentId } = payload;
    const dbc = getSupabaseAdmin();

    // Get upload info first (before deletion)
    const { data: upload } = await dbc
      .from("uploads")
      .select("source_url")
      .eq("id", documentId)
      .single();

    // Get tracking record
    const { data: tracking, error: trackErr } = await dbc
      .from("upload_vectors")
      .select("*")
      .eq("upload_id", documentId)
      .single();

    if (trackErr && trackErr.code !== 'PGRST116') { // PGRST116 = not found
      logger.error("Failed to fetch tracking record", { error: trackErr });
    }

    let deletedVectorCount = 0;

    // Delete vectors if tracking exists
    if (tracking && tracking.vector_ids && tracking.vector_ids.length > 0) {
      const targetTable = tracking.target_table || 'documents';
      const { error: delErr } = await dbc
        .from(targetTable)
        .delete()
        .in('id', tracking.vector_ids);

      if (delErr) {
        logger.error("Failed to delete vectors", { error: delErr });
      } else {
        deletedVectorCount = tracking.vector_ids.length;
      }

      // Delete tracking record
      await dbc.from("upload_vectors").delete().eq("id", tracking.id);
    }

    // Delete upload record (this will also trigger cascade delete via DB trigger)
    const { error: docDelErr } = await dbc
      .from("uploads")
      .delete()
      .eq("id", documentId);

    if (docDelErr) {
      logger.error("Failed to delete upload", { error: docDelErr });
      throw docDelErr;
    }

    // Delete from storage if exists
    if (upload?.source_url) {
      await dbc.storage.from('documents').remove([upload.source_url]);
    }

    return {
      ok: true,
      documentId,
      deletedVectors: deletedVectorCount
    };
  },
});

export const purgeOldDocuments = schedules.task({
  id: "purge-old-documents",
  cron: "0 3 * * *", // daily at 03:00 UTC
  run: async () => {
    const dbc = getSupabaseAdmin();
    
    // Get list of files in storage
    const { data: list, error } = await dbc.storage
      .from('documents')
      .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } });
    
    if (error) throw error;

    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];

    for (const item of list || []) {
      const createdAt = new Date(item.created_at).getTime();
      if (now - createdAt > THIRTY_DAYS) {
        toDelete.push(item.name);
      }
    }

    if (toDelete.length > 0) {
      await dbc.storage.from('documents').remove(toDelete);
    }

    return { deleted: toDelete.length };
  },
});

// --- Helpers ---

async function downloadToBuffer(src: string, usingPaths: boolean, supabase: any): Promise<Buffer> {
  if (usingPaths) {
    const { data: blob, error } = await supabase.storage.from('documents').download(src);
    if (error) throw error;
    const ab = await (blob as Blob).arrayBuffer();
    return Buffer.from(new Uint8Array(ab));
  } else {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch ${src}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(new Uint8Array(ab));
  }
}

function inferExt(name: string): string {
  const lower = name.toLowerCase().split('?')[0];
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.md')) return 'md';
  if (lower.endsWith('.txt')) return 'txt';
  return 'txt';
}

async function extractPdfChunks(buffer: Buffer): Promise<string[]> {
  // Use legacy build via require for maximum compatibility
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  
  // Convert Buffer to Uint8Array
  const uint8Array = new Uint8Array(buffer);
  
  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    // Disable worker to avoid worker file loading issues
    disableFontFace: true,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    pages.push(text);
  }

  return [pages.join('\n\n')];
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString('utf8');
}

type Chunk = { content: string; index: number };

function chunkTextWithIndices(input: string, targetChars = 1200): Chunk[] {
  const text = String(input || "").replace(/\r\n/g, "\n");
  const maxCharsPerChunk = 8000 * 3; // ~8000 tokens * 3 chars/token

  const chunks: Chunk[] = [];

  // Simple paragraph-based chunking
  const paras = text.split(/\n{2,}/g).map(p => p.trim()).filter(Boolean);
  let buf: string[] = [];
  let len = 0;

  const flush = () => {
    if (buf.length) {
      chunks.push({ content: buf.join("\n\n"), index: chunks.length });
      buf = [];
      len = 0;
    }
  };

  for (const p of paras) {
    if (p.length > maxCharsPerChunk) {
      // Split very large paragraphs
      flush();
      for (let i = 0; i < p.length; i += maxCharsPerChunk) {
        chunks.push({ content: p.slice(i, i + maxCharsPerChunk), index: chunks.length });
      }
      continue;
    }

    if (len + p.length + 2 > targetChars) flush();
    buf.push(p);
    len += p.length + 2;
  }

  flush();

  return chunks.length ? chunks : [{ content: text.slice(0, targetChars), index: 0 }];
}

// Legacy function for backwards compatibility
function chunkText(input: string, targetChars = 1200): string[] {
  return chunkTextWithIndices(input, targetChars).map(c => c.content);
}
