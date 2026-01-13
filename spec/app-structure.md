# App Structure & UI Specification

## Navigation Sidebar

The app has a left sidebar with three main sections:

### 1. **Content** (Default View)
- **Purpose**: View and manage all transcribed documents
- **Features**:
  - List of all documents with status (processing/completed/error)
  - Date range filter (From/To)
  - Pagination controls
  - Bulk actions (Ingest, Delete Selected)
  - Per-document actions:
    - **Ingest**: Trigger vector embedding generation
    - **Delete**: Remove document and all associated vectors
  - Document metadata display:
    - Transcript ID
    - Source (filename or URL)
    - Status with icon
    - Created timestamp

### 2. **Transcribe**
- **Purpose**: Upload new content for transcription
- **Tabs**:
  - **Video**: Upload MP4 files (drag & drop or file picker)
  - **Audio**: Upload audio files (MP3, WAV, etc.)
  - **Documents**: Upload PDFs, DOCX files
  - **YouTube**: Paste YouTube URL for transcript extraction
- **Features**:
  - Google Drive integration
  - Multi-file upload support
  - Progress tracking during upload
  - "Transcribe Videos" button to start processing

### 3. **Settings**
- **Purpose**: Configure metadata extraction
- **Features**:
  - **Metadata Fields Definition**:
    - Add custom metadata keys to extract from documents
    - Provide example values to guide AI extraction
    - Enable/disable fields
    - Delete fields
  - **Default Fields** (as shown in screenshot):
    - `course`: Course name or topic
    - `source`: Source URL or reference
    - `summary`: Document summary
    - `document_name`: Name of the document

## Database Schema Alignment

### Content View → `documents` table
```sql
SELECT 
  id as transcript_id,
  filename as source,
  status,
  created_at,
  metadata->>'ingested' as ingested_status
FROM documents
WHERE user_id = auth.uid()
ORDER BY created_at DESC;
```

### Settings View → `metadata_fields` table
```sql
SELECT 
  field_name as key,
  example_value as example
FROM metadata_fields
WHERE user_id = auth.uid()
AND enabled = true;
```

### Ingest Action → Trigger.dev Task
When user clicks "Ingest" on a document:
```typescript
await tasks.trigger("ingest-document", {
  userId: user.id,
  documentId: document.id,
  targetTable: "vector_documents"
});
```

### Delete Action → Automatic Cleanup
When user clicks "Delete" on a document:
```sql
-- This single DELETE triggers automatic vector cleanup
DELETE FROM documents WHERE id = ? AND user_id = auth.uid();

-- The database trigger automatically:
-- 1. Finds all vector_ids from document_vectors
-- 2. Deletes those vectors from vector_documents
-- 3. Deletes the tracking record from document_vectors
```

## User Flow

### Upload & Transcribe Flow
1. User navigates to **Transcribe** tab
2. Selects source type (Video/Audio/Documents/YouTube)
3. Uploads file(s) or pastes URL
4. Clicks "Transcribe Videos" button
5. Frontend creates `documents` record with status='processing'
6. Frontend triggers appropriate Trigger.dev task:
   - `transcribe-video` for video/audio
   - `youtube-transcript` for YouTube
   - `ingest-document` for PDFs (with text extraction)
7. Task updates document status to 'completed' or 'error'

### View & Manage Flow
1. User navigates to **Content** tab (default view)
2. Sees list of all documents with real-time status
3. Can filter by date range
4. For completed documents:
   - Click **Ingest** to generate embeddings
   - Click **Delete** to remove document and vectors
5. Ingestion status shown in metadata

### Configure Metadata Flow
1. User navigates to **Settings** tab
2. Views existing metadata fields
3. Can add new fields with examples
4. AI will extract these fields during ingestion
5. Extracted metadata stored in `vector_documents.metadata`

## API Routes Needed

### Frontend → Backend
```typescript
// Upload document
POST /api/documents/upload
Body: FormData with file(s)
Returns: { documentId, uploadUrl }

// Trigger transcription
POST /api/documents/transcribe
Body: { documentId, sourceType }
Returns: { taskId }

// Trigger ingestion
POST /api/documents/ingest
Body: { documentId }
Returns: { taskId }

// Delete document
DELETE /api/documents/:documentId
Returns: { success, deletedVectors }

// Get documents list
GET /api/documents?from=&to=&page=1
Returns: { documents[], total, page }

// Metadata fields CRUD
GET /api/metadata-fields
POST /api/metadata-fields
PUT /api/metadata-fields/:id
DELETE /api/metadata-fields/:id
```

## Real-time Updates

Use Supabase Realtime to show live status updates:

```typescript
// Subscribe to document changes
supabase
  .channel('documents')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'documents',
    filter: `user_id=eq.${userId}`
  }, (payload) => {
    // Update UI with new status/progress
    updateDocumentInList(payload.new);
  })
  .subscribe();
```

## Storage Structure

```
documents/
  └── {user_id}/
      └── {document_id}/
          └── {original_filename}
```

Example: `documents/123e4567-e89b-12d3-a456-426614174000/doc-abc123/video.mp4`

