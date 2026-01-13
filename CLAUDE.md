# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A document ingestion and RAG (Retrieval-Augmented Generation) system built with Next.js 16, Trigger.dev v4, and Supabase. Users can upload videos, audio, PDFs, DOCX files, or YouTube URLs, which are transcribed/extracted and converted to vector embeddings for semantic search.

## Commands

```bash
npm run dev                    # Start development server (http://localhost:3000)
npm run build                  # Build for production
npm run lint                   # Run ESLint
npx trigger.dev@latest dev     # Run Trigger.dev dev server for local task testing
npx trigger.dev@latest deploy  # Deploy Trigger.dev tasks to production
```

## Architecture

### Upload Flow

Files upload directly from browser to Supabase Storage (bypassing Vercel's 4.5MB limit), then only metadata is sent to API routes. This enables uploads up to 50GB.

```
Browser → Supabase Storage → /api/documents/register (metadata only) → /api/documents/transcribe
```

### Processing Pipeline

```
Upload → Type Detection → Process (Transcribe/Extract) → Chunk → Embed → Store in vector_documents
```

### Trigger.dev Tasks (src/trigger/ingestion.ts)

All background processing uses Trigger.dev v4 SDK. Tasks:
- `youtube-transcript` - Fetches YouTube transcripts via ScrapeCreators API
- `transcribe-video` - Transcribes audio/video via AssemblyAI (extracts audio with mediabunny for video)
- `extract-document-text` - Extracts text from PDF (pdf-parse) and DOCX (mammoth)
- `ingest-document` - Chunks text, generates embeddings (OpenAI text-embedding-3-small), stores vectors
- `delete-document` - Cleans up vectors and storage when documents are deleted
- `purge-old-documents` - Scheduled task (daily 03:00 UTC) removes files older than 30 days

### Key Directories

- `src/app/api/` - API routes for document management, search, metadata
- `src/trigger/` - Trigger.dev task definitions
- `src/components/dashboard/` - Upload components, documents table, settings UI
- `src/components/ui/` - shadcn/ui components
- `src/lib/supabase/` - Supabase client initialization
- `adr/migrations/` - Database migration SQL files

### Database Tables

- `documents` - Stores uploads, transcripts, and processing status
- `document_vectors` - Tracks vector IDs per document for cleanup
- `metadata_fields` - User-defined fields for AI extraction during ingestion
- `vector_documents` - Stores embeddings and chunked content

## Trigger.dev v4 SDK Usage

**MUST use `@trigger.dev/sdk/v3`, NEVER deprecated patterns like `client.defineJob`**

```typescript
import { task, wait, schedules } from "@trigger.dev/sdk/v3";

export const myTask = task({
  id: "my-task",
  run: async (payload: { data: string }) => {
    // Use wait.for() for delays (checkpointed, doesn't consume compute)
    await wait.for({ seconds: 30 });
    return { ok: true };
  },
});

// Triggering from API routes:
import { tasks } from "@trigger.dev/sdk/v3";
await tasks.trigger<typeof myTask>("my-task", { data: "value" });
```

When calling `triggerAndWait()`, the result is a `Result` object - check `result.ok` before accessing `result.output`.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ASSEMBLYAI_API_KEY
SCRAPE_CREATORS_API_KEY
OPENAI_API_KEY
TRIGGER_SECRET_KEY
```

## Authentication

Simple password-based auth using cookies. Fixed admin user UUID: `00000000-0000-0000-0000-000000000001`.
