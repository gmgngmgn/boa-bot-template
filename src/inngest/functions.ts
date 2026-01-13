import { inngest } from "./client";
import { AssemblyAI } from "assemblyai";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, generateObject } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

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

type IngestDocumentPayload = {
  userId: string;
  documentId: string;
  targetTable?: string;
  externalLink?: string;
};

const TARGET_CHARS_PER_CHUNK = 1200;
const MAX_TOKENS_PER_CHUNK = 8000;
const MAX_CHARS_PER_CHUNK = MAX_TOKENS_PER_CHUNK * 3; // ~3 chars per token

type Chunk = { content: string; index: number };

function normalizeText(input: string): string {
  return String(input || "").replace(/\r\n/g, "\n");
}

function splitLargeText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    if (end < text.length) {
      const sentenceEnd = Math.max(
        text.lastIndexOf(".", end),
        text.lastIndexOf("?", end),
        text.lastIndexOf("!", end)
      );

      if (sentenceEnd > start + maxChars * 0.5) {
        end = sentenceEnd + 1;
      } else {
        const spaceIndex = text.lastIndexOf(" ", end);
        if (spaceIndex > start + maxChars * 0.5) {
          end = spaceIndex;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end;
  }

  return chunks.filter(Boolean);
}

function chunkDocumentText(input: string, targetChars = TARGET_CHARS_PER_CHUNK): Chunk[] {
  const text = normalizeText(input);
  if (!text.trim()) return [];

  const paragraphs = text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let len = 0;
  const safeTargetChars = Math.min(targetChars, MAX_CHARS_PER_CHUNK);

  const flush = () => {
    if (!buffer.length) return;
    const chunk = buffer.join("\n\n");
    if (chunk.length > MAX_CHARS_PER_CHUNK) {
      const subChunks = splitLargeText(chunk, MAX_CHARS_PER_CHUNK);
      subChunks.forEach((c) => chunks.push({ content: c, index: chunks.length }));
    } else {
      chunks.push({ content: chunk, index: chunks.length });
    }
    buffer = [];
    len = 0;
  };

  for (const paragraph of paragraphs) {
    const para = paragraph.trim();
    if (!para) continue;

    if (para.length > MAX_CHARS_PER_CHUNK) {
      flush();
      const subChunks = splitLargeText(para, MAX_CHARS_PER_CHUNK);
      subChunks.forEach((c) => chunks.push({ content: c, index: chunks.length }));
      continue;
    }

    if (len + para.length + (buffer.length ? 2 : 0) > safeTargetChars) {
      flush();
    }

    buffer.push(para);
    len += para.length + (buffer.length > 1 ? 2 : 0);
  }

  flush();

  if (chunks.length === 0) {
    return [{ content: text.slice(0, safeTargetChars), index: 0 }];
  }

  return chunks;
}

// --- Functions ---

export const youtubeTranscript = inngest.createFunction(
  { id: "youtube-transcript" },
  { event: "youtube/transcript.requested" },
  async ({ event, step }) => {
    const { userId, documentId, url } = event.data as YoutubeTranscriptPayload;
    const apiKey = process.env.SCRAPE_CREATORS_API_KEY || process.env.NEXT_PUBLIC_SCRAPE_CREATORS_API_KEY;

    if (!apiKey) throw new Error("ScrapeCreators API key not configured");

    const dbc = getSupabaseAdmin();

    // Update status
    await step.run("update-status-processing", async () => {
      await dbc.from("documents").update({
        status: "processing",
        metadata: { progress: 5 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);
    });

    try {
      const transcriptText = await step.run("fetch-transcript", async () => {
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
        const text = String(data?.transcript_only_text || "").trim();
        if (!text) throw new Error("Transcript empty from ScrapeCreators");
        return text;
      });

      // Save success
      await step.run("save-success", async () => {
        await dbc.from("documents").update({
          status: "completed",
          transcript_text: transcriptText,
          metadata: { progress: 100 },
          updated_at: new Date().toISOString(),
        }).eq("id", documentId);
      });

      return { ok: true, documentId };

    } catch (err: any) {
      await step.run("save-failure", async () => {
        await dbc.from("documents").update({
          status: "error",
          metadata: { error: String(err?.message || err), progress: 0 },
          updated_at: new Date().toISOString(),
        }).eq("id", documentId);
      });
      throw err;
    }
  }
);

export const transcribeVideo = inngest.createFunction(
  { id: "transcribe-video" },
  { event: "video/transcribe.requested" },
  async ({ event, step }) => {
    const { userId, documentId, storagePath, filename } = event.data as TranscribeVideoPayload;
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) throw new Error("Missing ASSEMBLYAI_API_KEY env var");

    const client = new AssemblyAI({ apiKey });
    const dbc = getSupabaseAdmin();

    await step.run("update-status-processing", async () => {
      await dbc.from("documents").update({
        status: "processing",
        metadata: { progress: 5 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);
    });

    try {
      const audioUrl = await step.run("get-audio-url", async () => {
        const isAudioExt = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(filename);

        if (isAudioExt) {
          const { data: signed, error: signErr } = await dbc.storage
            .from('documents')
            .createSignedUrl(storagePath, 60 * 60 * 24 * 3);
          
          if (signErr) throw signErr;
          return signed.signedUrl;
        } else {
          // For video, simple approach: get signed URL and let AssemblyAI handle extraction
          // (Mediabunny might be too heavy for Inngest serverless timeout without streaming)
          const { data: signed, error: signErr } = await dbc.storage
            .from('documents')
            .createSignedUrl(storagePath, 60 * 60 * 24 * 3);
          
          if (signErr) throw signErr;
          return signed.signedUrl;
        }
      });

      const transcriptId = await step.run("submit-transcription", async () => {
        const transcript = await client.transcripts.create({ 
          audio_url: audioUrl, 
          speaker_labels: false 
        });
        return transcript.id;
      });

      // Polling loop
      let info: any = null;
      let completed = false;
      
      while (!completed) {
        await step.sleep("wait-for-transcription", "10s");
        
        info = await step.run("check-status", async () => {
          return await client.transcripts.get(transcriptId);
        });

        if (info.status === 'completed' || info.status === 'error') {
          completed = true;
        } else {
          // Update progress (simulated)
          await step.run("update-progress", async () => {
             await dbc.from("documents").update({ 
               metadata: { progress: 50 }, // Indeterminate progress
               updated_at: new Date().toISOString() 
             }).eq("id", documentId);
          });
        }
      }

      if (info.status === 'error') {
        throw new Error(`AssemblyAI error: ${info.error}`);
      }

      await step.run("save-transcript", async () => {
        await dbc.from("documents").update({
          status: "completed",
          transcript_text: info.text,
          metadata: { progress: 100, assemblyai_id: transcriptId },
          updated_at: new Date().toISOString(),
        }).eq("id", documentId);
      });

      return { ok: true, documentId };

    } catch (err: any) {
      await step.run("save-failure", async () => {
        await dbc.from("documents").update({
          status: "error",
          metadata: { error: String(err?.message || err), progress: 0 },
          updated_at: new Date().toISOString(),
        }).eq("id", documentId);
      });
      throw err;
    }
  }
);

export const extractDocumentText = inngest.createFunction(
  { id: "extract-document-text" },
  { event: "document/extract.requested" },
  async ({ event, step }) => {
    const { userId, documentId, storagePath, filename } = event.data;
    const dbc = getSupabaseAdmin();

    await step.run("update-status-processing", async () => {
      await dbc.from("documents").update({
        status: "processing",
        metadata: { progress: 10 },
        updated_at: new Date().toISOString(),
      }).eq("id", documentId);
    });

    try {
      const transcriptText = await step.run("extract-text", async () => {
        const { data: blob, error } = await dbc.storage.from('documents').download(storagePath);
        if (error) throw error;
        
        const buffer = Buffer.from(await blob.arrayBuffer());
        const ext = filename.split('.').pop()?.toLowerCase() || '';

        if (ext === 'pdf') {
          const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
          const pdfParse =
            (pdfParseModule as any)?.default || (pdfParseModule as any);
          
          if (typeof pdfParse !== 'function') {
            throw new Error(
              `pdf-parse import failed. Received type: ${typeof pdfParse}`
            );
          }
          
          const result = await pdfParse(buffer);
          return result?.text || '';
        } else if (ext === 'docx') {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          return result.value;
        } else {
          return buffer.toString('utf8');
        }
      });

      if (!transcriptText) throw new Error("Extracted text is empty");

      await step.run("save-text", async () => {
        await dbc.from('documents').update({
          transcript_text: transcriptText,
          status: 'completed',
          metadata: { progress: 100 },
          updated_at: new Date().toISOString(),
        }).eq('id', documentId);
      });

      return { ok: true, documentId };

    } catch (err: any) {
      await step.run("save-failure", async () => {
        await dbc.from("documents").update({
          status: "error",
          metadata: { error: String(err?.message || err), progress: 0 },
          updated_at: new Date().toISOString(),
        }).eq("id", documentId);
      });
      throw err;
    }
  }
);

export const ingestDocument = inngest.createFunction(
  { id: "ingest-document" },
  { event: "document/ingest.requested" },
  async ({ event, step }) => {
    const { userId, documentId, targetTable = "vector_documents", externalLink } = event.data as IngestDocumentPayload;
    const dbc = getSupabaseAdmin();

    // Get document
    const doc = await step.run("fetch-document", async () => {
      const { data, error } = await dbc
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .single();
      
      if (error || !data) throw new Error("Document not found");
      if (!data.transcript_text) throw new Error("Document has no transcript text");
      return data;
    });

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("Missing OPENAI_API_KEY");

    // Extract metadata fields
    const metadata = await step.run("extract-metadata", async () => {
      // Get fields definition
      const { data: defs } = await dbc
        .from('metadata_fields')
        .select('field_name')
        .eq('user_id', userId)
        .eq('enabled', true);
      
      const keys = (defs || []).map(d => String(d.field_name)).filter(Boolean);
      
      if (keys.length === 0) return {};

      const openai = createOpenAI({ apiKey: openaiKey });
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const k of keys) shape[k] = z.string().optional();
      const schema = z.object(shape);
      
      const prompt = `Extract fields: ${keys.join(", ")}. Text: ${(doc.transcript_text || "").slice(0, 20000)}`;
      const obj = await generateObject({ model: openai("gpt-4o-mini"), schema, prompt });
      return obj.object || {};
    });

    // Chunk and embed
    const vectorIds = await step.run("embed-and-store", async () => {
      const text = doc.transcript_text || "";
      const chunks = chunkDocumentText(text);
      if (chunks.length === 0) {
        throw new Error("No chunkable content found");
      }
      
      const openai = createOpenAI({ apiKey: openaiKey });
      const model = openai.embedding('text-embedding-3-small');
      const ids: string[] = [];
      const maxRetries = 3;

      const systemMetadata = {
        ...metadata,
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
        const { embedding } = await embed({ model, value: content });
            embeddingVector = embedding;
          } catch (err: any) {
            embedError = String(err?.message || err);
            if (attempts < maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, attempts * 250));
            }
          }
        }

        if (!embeddingVector) {
          // Skip storing the chunk if embedding failed after retries
          continue;
        }
        
        const payload = {
          user_id: userId,
          content,
          embedding: embeddingVector,
          metadata: {
            ...systemMetadata,
            _chunk_index: chunk.index,
            _embedding_status: embeddingVector ? 'success' : 'failed',
            _embedding_error: embedError,
            _embedding_attempts: attempts,
            _estimated_tokens: estimatedTokens,
          },
        };

        const { data: inserted, error } = await dbc
          .from(targetTable)
          .insert(payload)
          .select('id')
          .single();
        
        if (!error && inserted) {
          ids.push(inserted.id);
        }
      }

      return ids;
    });

    // Finalize
    await step.run("finalize-ingestion", async () => {
      if (vectorIds.length > 0) {
        // Tracking record
        await dbc.from("document_vectors").insert({
          user_id: userId,
          document_id: documentId,
          vector_ids: vectorIds,
          chunk_count: vectorIds.length,
        });

        // Update doc status
        await dbc.from("documents").update({
          metadata: {
            ...doc.metadata,
            ingested: true,
            vector_count: vectorIds.length,
            ...(externalLink && { external_link: externalLink }),
          },
          updated_at: new Date().toISOString(),
        }).eq("id", documentId);
      }
    });

    return { success: true, vectors: vectorIds.length };
  }
);
