# Document Ingestion System - Implementation Summary

## Overview
This is a **single-user document ingestion application** that allows users to upload videos, audio files, PDFs, and YouTube URLs, transcribe them, and store the content as searchable vector embeddings.

## Architecture

### Database Schema
- **`documents`**: Stores document metadata and transcribed text
- **`document_vectors`**: Tracks relationship between documents and their vector chunks
- **`vector_documents`**: Stores the actual vector embeddings (assumed to exist)

### Trigger.dev Tasks

#### 1. `youtube-transcript`
- Fetches transcripts from YouTube using ScrapeCreators API
- Updates document status and stores transcript text
- **Payload**: `{ userId, documentId, url }`

#### 2. `transcribe-video`
- Handles video/audio transcription via AssemblyAI
- Smart audio extraction: bypasses transcoding for audio files
- Uses mediabunny to extract audio from videos
- **Payload**: `{ userId, documentId, storagePath, filename }`

#### 3. `ingest-document`
- Chunks transcript text into manageable segments
- Generates embeddings using OpenAI's text-embedding-3-small
- Inserts vectors into `vector_documents` table
- Creates tracking record in `document_vectors`
- **Payload**: `{ userId, documentId, targetTable? }`

#### 4. `delete-document`
- Looks up tracking record to find associated vector IDs
- Deletes vectors from `vector_documents`
- Removes tracking record and document
- Cleans up storage files
- **Payload**: `{ userId, documentId }`

#### 5. `purge-old-documents` (Scheduled)
- Runs daily at 03:00 UTC
- Removes storage files older than 30 days

## Key Design Decisions

### 1. Explicit Vector Tracking
Instead of relying on metadata queries, we maintain an explicit `document_vectors` table that stores the array of vector IDs for each document. This provides:
- **Fast deletion**: `DELETE WHERE id = ANY(array)`
- **Auditability**: Know exactly which vectors belong to which document
- **Consistency**: Clear relationship between source and derived data

### 2. Single-User Architecture
Simplified from multi-tenant design:
- No `client_id` or client connection management
- Direct use of application's Supabase instance
- User isolation via RLS policies
- OpenAI API key stored as environment variable

### 3. Smart Audio Processing
- Audio files bypass video transcoding (faster, cheaper)
- Videos are transcoded to MP3 before upload to AssemblyAI
- Fallback to signed URLs if transcoding fails

## Environment Variables Required

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ASSEMBLYAI_API_KEY=your_assemblyai_key
SCRAPE_CREATORS_API_KEY=your_scrapecreators_key
OPENAI_API_KEY=your_openai_key
```

## Database Migration

Run the SQL from `adr/ADR-001-document-ingestion-sync.md` section 6.1 to create:
- `documents` table
- `document_vectors` table
- Indices for performance
- RLS policies for security

## Next Steps

### Immediate
1. **Run Database Migration**: Execute the SQL in the ADR
2. **Deploy Trigger.dev Tasks**: `npx trigger.dev@latest deploy`
3. **Test End-to-End**: Upload a test document and verify ingestion

### Frontend Implementation Needed
1. **Upload UI**: File picker with drag-and-drop
2. **Document List**: Show all documents with status
3. **Progress Tracking**: Real-time progress for transcription
4. **Delete Functionality**: Button to trigger `delete-document` task
5. **Search Interface**: Query `vector_documents` for semantic search

### Future Enhancements
1. **PDF/DOCX Support**: Add text extraction for document files
2. **Batch Upload**: Handle multiple files at once
3. **Metadata Extraction**: Use GPT to extract structured metadata
4. **Custom Chunking**: Allow users to configure chunk size
5. **Reconciliation Job**: Daily check to ensure vector tracking is accurate

## File Structure

```
src/trigger/
  └── ingestion.ts          # All Trigger.dev tasks

adr/
  └── ADR-001-document-ingestion-sync.md  # Architecture decision record

trigger.config.ts           # Trigger.dev configuration
```

## Scalability Considerations

### Current Limits
- **Chunk Size**: ~1200 characters (configurable)
- **Max Tokens**: 8000 per chunk (OpenAI limit)
- **Polling Timeout**: 15 minutes for transcription
- **Storage Retention**: 30 days for old files

### Performance
- **Chunking**: O(n) where n = text length
- **Embedding**: ~1-2s per chunk (OpenAI API)
- **Deletion**: O(1) with proper indexing
- **Large Documents**: 1000 chunks ≈ 16KB tracking overhead

### Maintainability
- **Modular Tasks**: Each task has a single responsibility
- **Error Handling**: Comprehensive logging and status updates
- **Retry Logic**: Trigger.dev handles automatic retries
- **Type Safety**: Full TypeScript types for payloads

## Potential Improvements

### Code Quality
1. **Extract Helpers**: Move chunking/embedding logic to separate modules
2. **Add Tests**: Unit tests for chunking logic, integration tests for tasks
3. **Better Error Messages**: User-friendly error descriptions
4. **Progress Callbacks**: More granular progress updates

### Features
1. **Document Versioning**: Track changes to documents over time
2. **Collaborative Editing**: Allow multiple users to share documents
3. **Export Functionality**: Download transcripts as text/JSON
4. **Analytics**: Track usage, popular documents, search queries

### Infrastructure
1. **Caching**: Cache embeddings for frequently accessed documents
2. **Queue Management**: Priority queue for urgent transcriptions
3. **Cost Optimization**: Batch embedding requests to reduce API calls
4. **Monitoring**: Add observability for task execution times

