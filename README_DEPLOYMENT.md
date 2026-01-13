# Document Ingestion System - Deployment Guide

## ✅ What's Been Built

A complete document ingestion system with:
- **Dashboard** with sidebar navigation
- **Content Page** - View and manage transcribed documents
- **Transcribe Page** - Upload videos, audio, documents, or YouTube URLs
- **Settings Page** - Configure metadata extraction fields
- **Ingest Modal** - Select target table and add external links
- **API Routes** - All backend endpoints
- **Trigger.dev Tasks** - Background processing
- **Database Schema** - Tables with automatic vector cleanup

---

## 🚀 Quick Start

### 1. Database Setup

Run the migration in your Supabase SQL Editor:
```bash
# File: adr/migrations/002_add_document_tracking.sql
```

This creates:
- `documents` table
- `document_vectors` tracking table
- `metadata_fields` table
- Automatic cleanup trigger
- RLS policies
- Storage bucket

### 2. Environment Variables

Copy `env.example` to `.env.local` and fill in your keys:

```bash
cp env.example .env.local
```

Required keys:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `ASSEMBLYAI_API_KEY` - For video/audio transcription
- `SCRAPE_CREATORS_API_KEY` - For YouTube transcripts
- `OPENAI_API_KEY` - For embeddings and metadata extraction
- `TRIGGER_SECRET_KEY` - Trigger.dev secret key

### 3. Install Dependencies

```bash
npm install
```

### 4. Deploy Trigger.dev Tasks

```bash
npx trigger.dev@latest deploy
```

### 5. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000`

---

## 📁 Project Structure

```
app/
├── dashboard/
│   ├── layout.tsx              # Dashboard layout with sidebar
│   ├── content/
│   │   └── page.tsx            # Documents table view
│   ├── transcribe/
│   │   └── page.tsx            # Upload interface with tabs
│   └── settings/
│       └── page.tsx            # Metadata fields management
│
├── api/
│   └── documents/
│       ├── route.ts            # GET/DELETE documents
│       ├── upload/route.ts     # POST upload files
│       ├── transcribe/route.ts # POST trigger transcription
│       └── ingest/route.ts     # POST trigger ingestion
│
components/
├── dashboard/
│   ├── Sidebar.tsx             # Navigation sidebar
│   ├── DocumentsTable.tsx      # Documents table with actions
│   ├── IngestModal.tsx         # Modal for ingestion config
│   ├── VideoUpload.tsx         # Video upload component
│   ├── AudioUpload.tsx         # Audio upload component
│   ├── DocumentUpload.tsx      # Document upload component
│   ├── YouTubeUpload.tsx       # YouTube URL input
│   └── MetadataFieldsManager.tsx # Settings page component
│
├── ui/                         # shadcn/ui components
│
lib/
├── supabase/
│   ├── client.ts               # Supabase client
│   └── types.ts                # Database types
│
src/trigger/
└── ingestion.ts                # 5 Trigger.dev tasks
```

---

## 🎯 User Flow

### 1. Upload & Transcribe

**Transcribe Page** → Select tab (Video/Audio/Documents/YouTube) → Upload/Enter URL → Click "Transcribe" → Redirects to Content page

### 2. View Documents

**Content Page** → See all documents with status → Filter by date → Real-time updates

### 3. Ingest Document

**Content Page** → Click "Ingest" on completed document → Modal opens:
- Select target table (vector_documents)
- Enter external link (optional)
- Click "Start Ingestion"

### 4. Configure Metadata

**Settings Page** → Add metadata fields:
- Field name (e.g., "course", "instructor")
- Example value (guides AI extraction)
- AI extracts these fields during ingestion

---

## 🔧 Features

### Content Page
- ✅ Documents table with real-time updates
- ✅ Status indicators (processing/completed/error)
- ✅ Date range filters
- ✅ Bulk selection and deletion
- ✅ Individual document actions
- ✅ Ingest modal with table + link selection

### Transcribe Page
- ✅ 4 tabs: Video, Audio, Documents, YouTube
- ✅ Drag & drop file upload
- ✅ Multi-file support
- ✅ File size display
- ✅ Google Drive integration (UI ready)
- ✅ Progress tracking

### Settings Page
- ✅ Add custom metadata fields
- ✅ Example values for AI guidance
- ✅ Enable/disable fields
- ✅ Delete fields
- ✅ Real-time updates

### Ingest Modal
- ✅ Target table selection
- ✅ External link input
- ✅ Document info display
- ✅ Progress tracking
- ✅ Error handling

---

## 🗄️ Database Tables

### documents
Stores uploaded documents and transcripts
- `id` - UUID primary key
- `user_id` - User reference
- `filename` - Original filename
- `source_type` - video/audio/pdf/youtube/document
- `source_url` - Storage path or URL
- `status` - processing/completed/error
- `transcript_text` - Extracted text
- `metadata` - JSONB (progress, errors, etc.)

### document_vectors
Tracks which vector IDs belong to which document
- `id` - UUID primary key
- `user_id` - User reference
- `document_id` - Document reference
- `vector_ids` - BIGINT[] (IDs from vector_documents)
- `chunk_count` - Number of chunks
- `target_table` - Table name
- `external_link` - User-provided URL

### metadata_fields
User-defined fields for AI extraction
- `id` - UUID primary key
- `user_id` - User reference
- `field_name` - Field name
- `example_value` - Example for AI
- `enabled` - Boolean

### vector_documents (existing)
Your existing vector table - unchanged
- `id` - BIGINT primary key
- `content` - TEXT
- `embedding` - VECTOR(1536)
- `metadata` - JSONB

---

## 🔄 API Endpoints

### GET /api/documents
Get list of documents with filters
```typescript
Query: { from?: date, to?: date, page: number, limit: number }
Returns: { documents: [], total: number, page: number }
```

### POST /api/documents/upload
Upload files to storage
```typescript
Body: FormData with files
Returns: { documentIds: string[], uploadUrls: string[] }
```

### POST /api/documents/transcribe
Trigger transcription tasks
```typescript
Body: { 
  documentIds?: string[], 
  sourceType: 'video' | 'audio' | 'document' | 'youtube',
  youtubeUrl?: string 
}
Returns: { taskIds: string[] }
```

### POST /api/documents/ingest
Trigger ingestion task
```typescript
Body: { 
  documentId: string, 
  targetTable: string,
  externalLink?: string 
}
Returns: { taskId: string }
```

### DELETE /api/documents
Delete documents (and vectors automatically)
```typescript
Body: { documentIds: string[] }
Returns: { deleted: number }
```

---

## 🎨 UI Components

All components use:
- **shadcn/ui** - Component library
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **Sonner** - Toast notifications
- **React Dropzone** - File uploads
- **date-fns** - Date formatting

---

## 🔐 Security

- ✅ Row Level Security (RLS) on all tables
- ✅ User isolation via `auth.uid()`
- ✅ Storage bucket policies
- ✅ Service role key for admin operations
- ✅ API route authentication

---

## 🧪 Testing

### 1. Upload a Video
1. Go to Transcribe → Video tab
2. Drop an MP4 file
3. Click "Transcribe Videos"
4. Check Content page for progress

### 2. Ingest a Document
1. Wait for transcription to complete
2. Click "Ingest" button
3. Enter external link (optional)
4. Click "Start Ingestion"
5. Check database for vectors

### 3. Delete a Document
1. Select document(s)
2. Click "Delete Selected"
3. Verify vectors are also deleted

### 4. Add Metadata Field
1. Go to Settings
2. Add field (e.g., "course")
3. Add example value
4. Ingest a document
5. Check vector metadata for extracted field

---

## 🐛 Troubleshooting

### Documents not appearing
- Check Supabase RLS policies
- Verify `user_id` matches `auth.uid()`
- Check browser console for errors

### Upload fails
- Verify storage bucket exists
- Check storage policies
- Ensure service role key is set

### Transcription stuck
- Check Trigger.dev dashboard
- Verify API keys (AssemblyAI, ScrapeCreators)
- Check task logs

### Vectors not deleted
- Verify trigger exists: `trigger_delete_document_vectors`
- Check `document_vectors` table has records
- Test trigger manually in SQL editor

---

## 📚 Additional Resources

- [Supabase Docs](https://supabase.com/docs)
- [Trigger.dev Docs](https://trigger.dev/docs)
- [shadcn/ui Docs](https://ui.shadcn.com)
- [AssemblyAI Docs](https://www.assemblyai.com/docs)

---

## 🎉 You're Ready!

The complete application is built and ready to deploy. Follow the steps above to get it running.

**Key Features:**
- ✅ Upload videos, audio, documents, YouTube URLs
- ✅ Automatic transcription
- ✅ AI metadata extraction
- ✅ Vector embeddings for semantic search
- ✅ Ingest modal with external link support
- ✅ Automatic vector cleanup on delete
- ✅ Real-time progress updates
- ✅ User isolation and security

Happy coding! 🚀

