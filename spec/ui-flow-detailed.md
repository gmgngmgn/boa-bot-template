# Detailed UI Flow & Component Specification

## Dashboard Layout

### Sidebar Navigation
```
┌─────────────────────┐
│ [User Profile]      │
├─────────────────────┤
│ ► Content           │  (default view)
│   Transcribe        │
│   Client Settings   │
└─────────────────────┘
```

---

## 1. Content Page (Default View)

### Layout
- **Header**: "Content" with date range filters (From/To)
- **Actions Bar**: "Ingest" and "Delete Selected" buttons
- **Table**: List of all transcripts with columns:
  - Checkbox (for bulk selection)
  - Transcript ID
  - Source (filename/URL)
  - Status (completed/processing/error with icon)
  - Created (timestamp)
  - Actions (Ingest button + menu)

### Ingest Button Click Flow

When user clicks "Ingest" on a document row:

**Step 1: Modal Opens** - "Ingest Document"

```
┌─────────────────────────────────────────────────┐
│ Ingest Document                            [X]  │
├─────────────────────────────────────────────────┤
│                                                 │
│ Target Table *                                  │
│ ┌─────────────────────────────────────────┐   │
│ │ vector_documents                      ▼ │   │
│ └─────────────────────────────────────────┘   │
│                                                 │
│ External Link (optional)                        │
│ ┌─────────────────────────────────────────┐   │
│ │ https://example.com/resource            │   │
│ └─────────────────────────────────────────┘   │
│                                                 │
│ This link will be added to metadata for         │
│ reference and included in search results.       │
│                                                 │
│         [Cancel]  [Start Ingestion]             │
└─────────────────────────────────────────────────┘
```

**Step 2: User Fills Form**
- Selects target table (dropdown with available tables)
- Optionally enters external link (e.g., course URL, source reference)

**Step 3: Trigger Ingestion**
- Frontend calls API: `POST /api/documents/ingest`
- Payload:
  ```json
  {
    "documentId": "uuid",
    "targetTable": "vector_documents",
    "externalLink": "https://example.com/resource"
  }
  ```
- API triggers Trigger.dev task with metadata

**Step 4: Progress Tracking**
- Modal shows progress bar
- Real-time updates via Supabase Realtime
- On completion: Success message + close modal

---

## 2. Transcribe Page

### Tabs
- **Video** (default)
- **Audio**
- **Documents**
- **YouTube**

### Video Tab Layout
```
┌─────────────────────────────────────────────────┐
│ Add video files                                 │
│ Supported: MP4. You can add multiple files.    │
├─────────────────────────────────────────────────┤
│                                                 │
│         Drag and drop MP4 files here            │
│                     or                          │
│            [Choose MP4 files]                   │
│                     or                          │
│         📁 Select from Google Drive             │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│ [Selected Files List]                           │
│ • video1.mp4 (125 MB) [X]                      │
│ • video2.mp4 (89 MB)  [X]                      │
│                                                 │
└─────────────────────────────────────────────────┘
                                [Transcribe Videos]
```

### Upload Flow
1. User selects/drops files
2. Files upload to Supabase Storage: `documents/{user_id}/{uuid}/filename`
3. Create `documents` record with status='processing'
4. Trigger `transcribe-video` task
5. Redirect to Content page to see progress

---

## 3. Client Settings Page

### Layout
```
┌─────────────────────────────────────────────────┐
│ Client Settings                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│ Client Supabase URL                             │
│ ┌─────────────────────────────────────────┐   │
│ │ https://xxx.supabase.co                 │   │
│ └─────────────────────────────────────────┘   │
│                                                 │
│ Client Supabase anon key                        │
│ ┌─────────────────────────────────────────┐   │
│ │ eyJhb...                                │   │
│ └─────────────────────────────────────────┘   │
│                                                 │
│ Client Supabase service role key                │
│ ┌─────────────────────────────────────────┐   │
│ │ service role key                        │   │
│ └─────────────────────────────────────────┘   │
│ Stored encrypted. Not displayed after saving.   │
│                                                 │
│ OpenAI API key                                  │
│ ┌─────────────────────────────────────────┐   │
│ │ sk-...                                  │   │
│ └─────────────────────────────────────────┘   │
│ Stored encrypted. Not displayed after saving.   │
│                                                 │
│              [Save connection]                  │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│ Metadata fields                                 │
│                                                 │
│ Define metadata keys to extract per document.   │
│ Extracted data is written to metadata JSONB     │
│ during ingestion.                               │
│                                                 │
│ Key                    Example value            │
│ ┌────────────────┐   ┌──────────────────────┐ │
│ │ Document Name  │   │ e.g. AI Client Gen   │ │
│ └────────────────┘   └──────────────────────┘ │
│                                                 │
│              [Add field]                        │
│                                                 │
│ Key              Example                Actions │
│ ─────────────────────────────────────────────── │
│ course           Inner Circle (assumed...)  [Delete] │
│ source           https://jeremy-haynes...   [Delete] │
│ summary          document summary           [Delete] │
│ document_name    document name              [Delete] │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Metadata Fields Management
- User adds custom fields (e.g., "course", "instructor", "topic")
- Provides example values to guide AI extraction
- During ingestion, OpenAI extracts these fields from transcript text
- Extracted values stored in `vector_documents.metadata`

---

## Database Schema Updates

### documents table
```sql
CREATE TABLE public.documents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  filename TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  transcript_text TEXT,
  metadata JSONB DEFAULT '{}',  -- stores progress, errors, etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### document_vectors table (tracking)
```sql
CREATE TABLE public.document_vectors (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  document_id UUID NOT NULL,
  vector_ids BIGINT[] NOT NULL,  -- IDs from vector_documents
  chunk_count INT NOT NULL,
  target_table TEXT NOT NULL,     -- which table was used
  external_link TEXT,             -- user-provided link
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### metadata_fields table
```sql
CREATE TABLE public.metadata_fields (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  example_value TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, field_name)
);
```

### vector_documents (existing - no changes)
```sql
-- Your existing table structure
-- id: bigint
-- content: text
-- embedding: vector
-- metadata: jsonb  -- will contain extracted fields + external_link
```

---

## API Routes

### Content Page APIs

```typescript
// Get documents list
GET /api/documents
Query: { from?: date, to?: date, page: number, limit: number }
Returns: { documents: Document[], total: number, page: number }

// Trigger ingestion (opens modal)
POST /api/documents/ingest
Body: { 
  documentId: string, 
  targetTable: string,
  externalLink?: string 
}
Returns: { taskId: string }

// Delete document(s)
DELETE /api/documents
Body: { documentIds: string[] }
Returns: { deleted: number }
```

### Transcribe Page APIs

```typescript
// Upload to storage
POST /api/documents/upload
Body: FormData with files
Returns: { documentIds: string[], uploadUrls: string[] }

// Trigger transcription
POST /api/documents/transcribe
Body: { 
  documentIds: string[], 
  sourceType: 'video' | 'audio' | 'document' | 'youtube',
  youtubeUrl?: string  // if sourceType is youtube
}
Returns: { taskIds: string[] }
```

### Settings Page APIs

```typescript
// Get metadata fields
GET /api/metadata-fields
Returns: { fields: MetadataField[] }

// Add metadata field
POST /api/metadata-fields
Body: { fieldName: string, exampleValue: string }
Returns: { field: MetadataField }

// Delete metadata field
DELETE /api/metadata-fields/:id
Returns: { success: boolean }

// Save client connection (optional - if multi-tenant)
POST /api/client-settings
Body: { 
  supabaseUrl: string, 
  anonKey: string,
  serviceKey: string, 
  openaiKey: string 
}
Returns: { success: boolean }
```

---

## Trigger.dev Task Updates

### ingestDocument Task

```typescript
type IngestDocumentPayload = {
  userId: string;
  documentId: string;
  targetTable: string;
  externalLink?: string;  // NEW: user-provided link
};

export const ingestDocument = task({
  id: "ingest-document",
  run: async (payload: IngestDocumentPayload) => {
    const { userId, documentId, targetTable, externalLink } = payload;
    
    // ... existing logic ...
    
    // When inserting vectors, add external_link to metadata
    const vectorPayload = {
      content: chunk,
      embedding: vector,
      metadata: {
        ...extractedMetadata,  // AI-extracted fields
        document_id: documentId,
        filename: doc.filename,
        external_link: externalLink,  // User-provided link
      }
    };
    
    // ... insert and track vector_ids ...
    
    // Save tracking record with external_link
    await dbc.from("document_vectors").insert({
      user_id: userId,
      document_id: documentId,
      vector_ids: insertedIds,
      chunk_count: insertedIds.length,
      target_table: targetTable,
      external_link: externalLink,  // Store for reference
    });
  }
});
```

---

## Component Structure

```
app/
├── dashboard/
│   ├── layout.tsx              # Sidebar + main content area
│   ├── content/
│   │   ├── page.tsx            # Content table view
│   │   └── IngestModal.tsx     # Modal for table + link selection
│   ├── transcribe/
│   │   ├── page.tsx            # Tabbed upload interface
│   │   └── UploadZone.tsx      # Drag & drop component
│   └── settings/
│       ├── page.tsx            # Client settings + metadata fields
│       └── MetadataFieldForm.tsx
│
components/
├── DocumentsTable.tsx          # Reusable table with actions
├── StatusBadge.tsx             # Status indicator
└── ProgressBar.tsx             # For upload/transcription progress
```

---

## User Flow Summary

### Upload → Transcribe → View → Ingest → Search

1. **Upload** (Transcribe page)
   - User uploads video/audio/document
   - Files go to Supabase Storage
   - `documents` record created

2. **Transcribe** (Background)
   - Trigger.dev task processes file
   - Updates status in real-time
   - Saves transcript_text to `documents`

3. **View** (Content page)
   - User sees completed transcripts
   - Can filter by date, search, paginate

4. **Ingest** (Modal)
   - User clicks "Ingest" button
   - Selects target table
   - Adds optional external link
   - Confirms ingestion

5. **Process** (Background)
   - AI extracts metadata fields (from Settings)
   - Generates embeddings
   - Inserts into `vector_documents`
   - Tracks IDs in `document_vectors`

6. **Search** (Future)
   - User queries semantic search
   - Results include extracted metadata + external_link
   - Can click link to go to original source

---

## Next Steps for Implementation

1. ✅ Database migration (done - `002_add_document_tracking.sql`)
2. ✅ Trigger.dev tasks (done - `src/trigger/ingestion.ts`)
3. 🔲 Build dashboard layout with sidebar
4. 🔲 Implement Content page with table
5. 🔲 Create IngestModal component
6. 🔲 Build Transcribe page with tabs
7. 🔲 Implement Settings page with metadata fields
8. 🔲 Add API routes for all operations
9. 🔲 Set up Supabase Realtime for progress updates
10. 🔲 Test end-to-end flow

