-- =====================================================
-- Document Ingestion System - Database Migration
-- =====================================================
-- This migration creates the tables needed for document
-- ingestion with automatic vector cleanup on deletion.
-- =====================================================

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- 1. DOCUMENTS TABLE
-- =====================================================
-- Stores document metadata and transcribed text
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('video', 'audio', 'pdf', 'youtube', 'document')),
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),
  transcript_text TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at DESC);

-- =====================================================
-- 2. VECTOR_DOCUMENTS TABLE
-- =====================================================
-- Stores vector embeddings for semantic search
CREATE TABLE IF NOT EXISTS public.vector_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_vector_documents_user_id ON public.vector_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_vector_documents_metadata ON public.vector_documents USING gin(metadata);

-- Vector similarity search index (HNSW for fast approximate nearest neighbor search)
CREATE INDEX IF NOT EXISTS idx_vector_documents_embedding ON public.vector_documents 
USING hnsw (embedding vector_cosine_ops);

-- =====================================================
-- 3. DOCUMENT_VECTORS TABLE (Tracking)
-- =====================================================
-- Tracks which vector chunks belong to which document
-- This enables efficient cleanup when documents are deleted
CREATE TABLE IF NOT EXISTS public.document_vectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  vector_ids UUID[] NOT NULL,
  chunk_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_document_vectors_document_id ON public.document_vectors(document_id);
CREATE INDEX IF NOT EXISTS idx_document_vectors_user_id ON public.document_vectors(user_id);

-- =====================================================
-- 4. METADATA_FIELDS TABLE
-- =====================================================
-- Stores user-defined metadata fields for extraction
CREATE TABLE IF NOT EXISTS public.metadata_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  example_value TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, field_name)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_metadata_fields_user_id ON public.metadata_fields(user_id);

-- =====================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vector_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_fields ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running migration)
DROP POLICY IF EXISTS "Users can view their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can view their own vectors" ON public.vector_documents;
DROP POLICY IF EXISTS "Users can insert their own vectors" ON public.vector_documents;
DROP POLICY IF EXISTS "Users can delete their own vectors" ON public.vector_documents;
DROP POLICY IF EXISTS "Users can view their own document vectors" ON public.document_vectors;
DROP POLICY IF EXISTS "Service role can manage document vectors" ON public.document_vectors;
DROP POLICY IF EXISTS "Users can view their own metadata fields" ON public.metadata_fields;
DROP POLICY IF EXISTS "Users can insert their own metadata fields" ON public.metadata_fields;
DROP POLICY IF EXISTS "Users can update their own metadata fields" ON public.metadata_fields;
DROP POLICY IF EXISTS "Users can delete their own metadata fields" ON public.metadata_fields;

-- Documents policies
CREATE POLICY "Users can view their own documents"
  ON public.documents FOR SELECT
  USING (auth.uid() = documents.user_id);

CREATE POLICY "Users can insert their own documents"
  ON public.documents FOR INSERT
  WITH CHECK (auth.uid() = documents.user_id);

CREATE POLICY "Users can update their own documents"
  ON public.documents FOR UPDATE
  USING (auth.uid() = documents.user_id);

CREATE POLICY "Users can delete their own documents"
  ON public.documents FOR DELETE
  USING (auth.uid() = documents.user_id);

-- Vector documents policies
CREATE POLICY "Users can view their own vectors"
  ON public.vector_documents FOR SELECT
  USING (auth.uid() = vector_documents.user_id);

CREATE POLICY "Users can insert their own vectors"
  ON public.vector_documents FOR INSERT
  WITH CHECK (auth.uid() = vector_documents.user_id);

CREATE POLICY "Users can delete their own vectors"
  ON public.vector_documents FOR DELETE
  USING (auth.uid() = vector_documents.user_id);

-- Document vectors policies (tracking table)
CREATE POLICY "Users can view their own document vectors"
  ON public.document_vectors FOR SELECT
  USING (auth.uid() = document_vectors.user_id);

CREATE POLICY "Service role can manage document vectors"
  ON public.document_vectors FOR ALL
  USING (true);

-- Metadata fields policies
CREATE POLICY "Users can view their own metadata fields"
  ON public.metadata_fields FOR SELECT
  USING (auth.uid() = metadata_fields.user_id);

CREATE POLICY "Users can insert their own metadata fields"
  ON public.metadata_fields FOR INSERT
  WITH CHECK (auth.uid() = metadata_fields.user_id);

CREATE POLICY "Users can update their own metadata fields"
  ON public.metadata_fields FOR UPDATE
  USING (auth.uid() = metadata_fields.user_id);

CREATE POLICY "Users can delete their own metadata fields"
  ON public.metadata_fields FOR DELETE
  USING (auth.uid() = metadata_fields.user_id);

-- =====================================================
-- 6. TRIGGER FUNCTION FOR AUTOMATIC VECTOR CLEANUP
-- =====================================================
-- This function automatically deletes vector chunks when a document is deleted
CREATE OR REPLACE FUNCTION public.delete_document_vectors()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete all vector chunks associated with this document
  DELETE FROM public.vector_documents
  WHERE id = ANY(
    SELECT unnest(vector_ids)
    FROM public.document_vectors
    WHERE document_id = OLD.id
  );
  
  -- The document_vectors tracking record will be deleted automatically
  -- via ON DELETE CASCADE foreign key constraint
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to run the cleanup function before document deletion
DROP TRIGGER IF EXISTS trigger_delete_document_vectors ON public.documents;
CREATE TRIGGER trigger_delete_document_vectors
  BEFORE DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_document_vectors();

-- =====================================================
-- 7. HELPER FUNCTION FOR SEMANTIC SEARCH
-- =====================================================
-- Function to search documents by semantic similarity
CREATE OR REPLACE FUNCTION public.search_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  filter_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vector_documents.id,
    vector_documents.content,
    vector_documents.metadata,
    1 - (vector_documents.embedding <=> query_embedding) as similarity
  FROM public.vector_documents
  WHERE 
    (filter_user_id IS NULL OR vector_documents.user_id = filter_user_id)
    AND 1 - (vector_documents.embedding <=> query_embedding) > match_threshold
  ORDER BY vector_documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =====================================================
-- 8. STORAGE BUCKET FOR DOCUMENTS
-- =====================================================
-- Create storage bucket for uploaded documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Drop existing storage policies if they exist
DROP POLICY IF EXISTS "Users can upload their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;

-- Storage policies
CREATE POLICY "Users can upload their own documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- =====================================================
-- 9. UPDATED_AT TRIGGER
-- =====================================================
-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to documents table
DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Apply to metadata_fields table
DROP TRIGGER IF EXISTS update_metadata_fields_updated_at ON public.metadata_fields;
CREATE TRIGGER update_metadata_fields_updated_at
  BEFORE UPDATE ON public.metadata_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- You can now:
-- 1. Upload documents via the UI
-- 2. Trigger transcription tasks
-- 3. Ingest documents into vector_documents
-- 4. Delete documents (vectors will be automatically cleaned up)
-- 5. Search documents semantically
-- =====================================================

