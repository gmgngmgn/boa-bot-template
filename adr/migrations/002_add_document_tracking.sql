-- =====================================================
-- Document Tracking Migration
-- Works with EXISTING vector_documents table
-- =====================================================

-- Step 0: Create admin user if using simple password auth
-- This creates a placeholder user for the system
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'admin@local.dev',
  'password-not-used',
  now(),
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Step 1: Create documents table for tracking uploads
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

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at DESC);

-- Step 2: Create tracking table (links documents to vector_documents)
CREATE TABLE IF NOT EXISTS public.document_vectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  vector_ids BIGINT[] NOT NULL,  -- BIGINT because your vector_documents.id is bigint
  chunk_count INT NOT NULL DEFAULT 0,
  target_table TEXT NOT NULL DEFAULT 'vector_documents',
  external_link TEXT,  -- User-provided link (e.g., course URL, source reference)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_vectors_document_id ON public.document_vectors(document_id);
CREATE INDEX IF NOT EXISTS idx_document_vectors_user_id ON public.document_vectors(user_id);

-- Step 3: Create metadata_fields table for Settings page
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

CREATE INDEX IF NOT EXISTS idx_metadata_fields_user_id ON public.metadata_fields(user_id);

-- Step 4: Enable RLS on new tables
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_fields ENABLE ROW LEVEL SECURITY;

-- Step 5: RLS Policies for documents
DROP POLICY IF EXISTS "Users can view their own documents" ON public.documents;
CREATE POLICY "Users can view their own documents"
  ON public.documents FOR SELECT
  USING (auth.uid() = documents.user_id);

DROP POLICY IF EXISTS "Users can insert their own documents" ON public.documents;
CREATE POLICY "Users can insert their own documents"
  ON public.documents FOR INSERT
  WITH CHECK (auth.uid() = documents.user_id);

DROP POLICY IF EXISTS "Users can update their own documents" ON public.documents;
CREATE POLICY "Users can update their own documents"
  ON public.documents FOR UPDATE
  USING (auth.uid() = documents.user_id);

DROP POLICY IF EXISTS "Users can delete their own documents" ON public.documents;
CREATE POLICY "Users can delete their own documents"
  ON public.documents FOR DELETE
  USING (auth.uid() = documents.user_id);

-- Step 6: RLS Policies for document_vectors (tracking table)
DROP POLICY IF EXISTS "Users can view their own document vectors" ON public.document_vectors;
CREATE POLICY "Users can view their own document vectors"
  ON public.document_vectors FOR SELECT
  USING (auth.uid() = document_vectors.user_id);

DROP POLICY IF EXISTS "Service role can manage document vectors" ON public.document_vectors;
CREATE POLICY "Service role can manage document vectors"
  ON public.document_vectors FOR ALL
  USING (true);

-- Step 7: RLS Policies for metadata_fields
DROP POLICY IF EXISTS "Users can view their own metadata fields" ON public.metadata_fields;
CREATE POLICY "Users can view their own metadata fields"
  ON public.metadata_fields FOR SELECT
  USING (auth.uid() = metadata_fields.user_id);

DROP POLICY IF EXISTS "Users can insert their own metadata fields" ON public.metadata_fields;
CREATE POLICY "Users can insert their own metadata fields"
  ON public.metadata_fields FOR INSERT
  WITH CHECK (auth.uid() = metadata_fields.user_id);

DROP POLICY IF EXISTS "Users can update their own metadata fields" ON public.metadata_fields;
CREATE POLICY "Users can update their own metadata fields"
  ON public.metadata_fields FOR UPDATE
  USING (auth.uid() = metadata_fields.user_id);

DROP POLICY IF EXISTS "Users can delete their own metadata fields" ON public.metadata_fields;
CREATE POLICY "Users can delete their own metadata fields"
  ON public.metadata_fields FOR DELETE
  USING (auth.uid() = metadata_fields.user_id);

-- Step 8: Trigger function to delete vector chunks when document is deleted
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
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_delete_document_vectors ON public.documents;
CREATE TRIGGER trigger_delete_document_vectors
  BEFORE DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_document_vectors();

-- Step 9: Updated_at trigger function
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

-- Step 10: Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Step 11: Storage policies
DROP POLICY IF EXISTS "Users can upload their own documents" ON storage.objects;
CREATE POLICY "Users can upload their own documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can view their own documents" ON storage.objects;
CREATE POLICY "Users can view their own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;
CREATE POLICY "Users can delete their own documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Now when you DELETE from documents:
-- 1. Trigger finds all vector_ids from document_vectors
-- 2. Deletes those rows from vector_documents (your existing table)
-- 3. Cascade deletes the document_vectors tracking record
-- =====================================================

