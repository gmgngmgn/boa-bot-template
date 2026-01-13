# ✅ Implementation Ready - Document Ingestion System

## 🎯 What You Have Now

### 1. **Database Migration** ✅
**File**: `adr/migrations/002_add_document_tracking.sql`

Run this in your Supabase SQL Editor to create:
- `documents` table - tracks all uploads
- `document_vectors` table - tracks vector IDs with external links
- `metadata_fields` table - user-defined extraction fields
- Automatic trigger - deletes vectors when document is deleted
- RLS policies - full user isolation
- Storage bucket - for file uploads

**Key Feature**: `external_link` column stores user-provided URLs in tracking table

### 2. **Trigger.dev Tasks** ✅
**File**: `src/trigger/ingestion.ts`

5 production-ready tasks:
- `youtube-transcript` - Fetches YouTube transcripts
- `transcribe-video` - Transcribes video/audio via AssemblyAI
- `ingest-document` - **Now accepts `externalLink` parameter**
- `delete-document` - Cleans up vectors automatically
- `purge-old-documents` - Scheduled cleanup

### 3. **UI Specification** ✅
**File**: `spec/ui-flow-detailed.md`

Complete UI flow with:
- Dashboard layout with sidebar
- Content page with Ingest modal
- Transcribe page with tabs
- Settings page with metadata fields

---

## 🚀 Ingest Modal Flow

### When User Clicks "Ingest" Button

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
│ │ https://course.com/lesson-1             │   │
│ └─────────────────────────────────────────┘   │
│                                                 │
│ This link will be added to metadata and         │
│ included in search results.                     │
│                                                 │
│         [Cancel]  [Start Ingestion]             │
└─────────────────────────────────────────────────┘
```

### Frontend Code Example

```typescript
// When user submits modal
const handleIngest = async (documentId: string, targetTable: string, externalLink?: string) => {
  const response = await fetch('/api/documents/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId,
      targetTable,
      externalLink  // Optional user-provided link
    })
  });
  
  const { taskId } = await response.json();
  
  // Show progress modal
  // Subscribe to Supabase Realtime for updates
};
```

### Backend API Route

```typescript
// app/api/documents/ingest/route.ts
export async function POST(req: Request) {
  const { documentId, targetTable, externalLink } = await req.json();
  const userId = await getCurrentUserId();
  
  // Trigger Trigger.dev task
  const handle = await tasks.trigger("ingest-document", {
    userId,
    documentId,
    targetTable,
    externalLink  // Passed to task
  });
  
  return Response.json({ taskId: handle.id });
}
```

### What Happens During Ingestion

1. **Chunk Text** - Breaks transcript into ~1200 char chunks
2. **Extract Metadata** - AI extracts fields defined in Settings
3. **Generate Embeddings** - OpenAI text-embedding-3-small
4. **Insert Vectors** - Into `vector_documents` with metadata:
   ```json
   {
     "document_id": "uuid",
     "filename": "video.mp4",
     "source_type": "video",
     "external_link": "https://course.com/lesson-1",  // ← User-provided
     "course": "Inner Circle",  // ← AI-extracted
     "summary": "Document about..."  // ← AI-extracted
   }
   ```
5. **Track IDs** - Store vector IDs + external_link in `document_vectors`

---

## 📊 Database Schema

### documents
```sql
id              UUID PRIMARY KEY
user_id         UUID NOT NULL
filename        TEXT NOT NULL
source_type     TEXT NOT NULL  -- 'video', 'audio', 'pdf', 'youtube'
source_url      TEXT
status          TEXT NOT NULL  -- 'processing', 'completed', 'error'
transcript_text TEXT
metadata        JSONB          -- progress, errors, etc.
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

### document_vectors (tracking)
```sql
id              UUID PRIMARY KEY
user_id         UUID NOT NULL
document_id     UUID NOT NULL
vector_ids      BIGINT[]       -- IDs from vector_documents
chunk_count     INT NOT NULL
target_table    TEXT NOT NULL  -- 'vector_documents'
external_link   TEXT           -- ← NEW: User-provided link
created_at      TIMESTAMPTZ
```

### metadata_fields
```sql
id              UUID PRIMARY KEY
user_id         UUID NOT NULL
field_name      TEXT NOT NULL
example_value   TEXT
enabled         BOOLEAN
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
UNIQUE(user_id, field_name)
```

### vector_documents (your existing table - unchanged)
```sql
id              BIGINT PRIMARY KEY
content         TEXT
embedding       VECTOR(1536)
metadata        JSONB  -- contains external_link + AI-extracted fields
fts             TSVECTOR
```

---

## 🎨 Component Structure to Build

```
app/
├── dashboard/
│   ├── layout.tsx                    # Sidebar + main area
│   ├── content/
│   │   ├── page.tsx                  # Documents table
│   │   └── components/
│   │       ├── IngestModal.tsx       # ← NEW: Table + Link selection
│   │       ├── DocumentsTable.tsx
│   │       └── StatusBadge.tsx
│   ├── transcribe/
│   │   ├── page.tsx                  # Tabbed interface
│   │   └── components/
│   │       ├── VideoUpload.tsx
│   │       ├── AudioUpload.tsx
│   │       ├── DocumentUpload.tsx
│   │       └── YouTubeUpload.tsx
│   └── settings/
│       ├── page.tsx                  # Metadata fields management
│       └── components/
│           ├── MetadataFieldForm.tsx
│           └── MetadataFieldsList.tsx
│
├── api/
│   └── documents/
│       ├── route.ts                  # GET /api/documents
│       ├── upload/route.ts           # POST /api/documents/upload
│       ├── transcribe/route.ts       # POST /api/documents/transcribe
│       └── ingest/route.ts           # POST /api/documents/ingest
│
components/
├── ui/                               # shadcn components (already have)
└── dashboard/
    ├── Sidebar.tsx
    ├── ProgressBar.tsx
    └── UploadZone.tsx
```

---

## 🔄 Complete User Flow

### 1. Upload (Transcribe Page)
```
User selects video → Upload to Storage → Create document record → 
Trigger transcribe-video task → Show progress → Redirect to Content
```

### 2. View (Content Page)
```
User sees completed documents → Can filter/search/paginate →
Clicks "Ingest" button → Modal opens
```

### 3. Ingest (Modal)
```
User selects target table → Enters external link (optional) →
Clicks "Start Ingestion" → Trigger ingest-document task →
Show progress → Success message
```

### 4. Search (Future)
```
User queries semantic search → Results include metadata + external_link →
User clicks link → Opens original source
```

---

## ✅ Deployment Checklist

### 1. Database
- [ ] Run `002_add_document_tracking.sql` in Supabase SQL Editor
- [ ] Verify tables created: `documents`, `document_vectors`, `metadata_fields`
- [ ] Test trigger: Delete a document, verify vectors are deleted

### 2. Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
ASSEMBLYAI_API_KEY=your_key
SCRAPE_CREATORS_API_KEY=your_key
OPENAI_API_KEY=your_key
```

### 3. Trigger.dev
```bash
npx trigger.dev@latest deploy
```

### 4. Frontend
- [ ] Build dashboard layout with sidebar
- [ ] Create IngestModal component
- [ ] Add API routes
- [ ] Set up Supabase Realtime subscriptions
- [ ] Test end-to-end flow

---

## 🎯 Key Features

✅ **Automatic Vector Cleanup** - Delete document = delete all vectors  
✅ **External Link Support** - User can add reference URLs  
✅ **AI Metadata Extraction** - Configurable fields in Settings  
✅ **Real-time Progress** - Via Supabase Realtime  
✅ **Multi-format Support** - Video, Audio, PDF, YouTube  
✅ **User Isolation** - RLS policies for security  
✅ **Type Safety** - Full TypeScript throughout  

---

## 📝 Next Steps

1. **Run the migration** - Create tables
2. **Deploy Trigger.dev tasks** - Background processing
3. **Build IngestModal** - Table + Link selection UI
4. **Create API routes** - Connect frontend to backend
5. **Test ingestion flow** - Upload → Transcribe → Ingest → Search

You now have everything you need to build the complete UI! 🚀

