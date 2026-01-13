-- =====================================================
-- Uploads Table - Tracks ingested documents/assets
-- =====================================================
-- Run this migration in Supabase SQL Editor

-- Create admin user for the application
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  role,
  aud,
  confirmation_token
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'admin@elite-ecommerce.local',
  '',
  now(),
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- Create uploads table for tracking ingested content
CREATE TABLE IF NOT EXISTS public.uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  filename TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('video', 'audio', 'pdf', 'youtube', 'document', 'link')),
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),
  transcript_text TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create upload_vectors table for tracking which vectors belong to which upload
CREATE TABLE IF NOT EXISTS public.upload_vectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  upload_id UUID NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  vector_ids BIGINT[] DEFAULT '{}',
  chunk_count INTEGER DEFAULT 0,
  target_table TEXT DEFAULT 'documents',
  external_link TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create metadata_fields table for user-defined extraction fields
CREATE TABLE IF NOT EXISTS public.metadata_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  field_name TEXT NOT NULL,
  example_value TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON public.uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON public.uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON public.uploads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_vectors_upload_id ON public.upload_vectors(upload_id);
CREATE INDEX IF NOT EXISTS idx_metadata_fields_user_id ON public.metadata_fields(user_id);

-- Enable RLS
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_fields ENABLE ROW LEVEL SECURITY;

-- Policies (service role has full access)
CREATE POLICY "Service role full access to uploads" ON public.uploads FOR ALL USING (true);
CREATE POLICY "Service role full access to upload_vectors" ON public.upload_vectors FOR ALL USING (true);
CREATE POLICY "Service role full access to metadata_fields" ON public.metadata_fields FOR ALL USING (true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to uploads
DROP TRIGGER IF EXISTS update_uploads_updated_at ON public.uploads;
CREATE TRIGGER update_uploads_updated_at
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Apply trigger to metadata_fields
DROP TRIGGER IF EXISTS update_metadata_fields_updated_at ON public.metadata_fields;
CREATE TRIGGER update_metadata_fields_updated_at
  BEFORE UPDATE ON public.metadata_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Cascade Delete: Remove vectors when upload is deleted
-- =====================================================

-- Function to delete vectors from documents table when upload is deleted
CREATE OR REPLACE FUNCTION public.delete_upload_vectors()
RETURNS TRIGGER AS $$
DECLARE
  vec_ids BIGINT[];
  tracking_row RECORD;
BEGIN
  -- Get all vector tracking records for this upload
  FOR tracking_row IN
    SELECT vector_ids, target_table FROM public.upload_vectors WHERE upload_id = OLD.id
  LOOP
    -- Delete vectors from the target table (documents or student_documents)
    IF tracking_row.target_table = 'documents' THEN
      DELETE FROM public.documents WHERE id = ANY(tracking_row.vector_ids);
    ELSIF tracking_row.target_table = 'student_documents' THEN
      DELETE FROM public.student_documents WHERE id = ANY(tracking_row.vector_ids);
    END IF;
  END LOOP;

  -- Also delete any vectors that have this upload_id in metadata
  DELETE FROM public.documents
  WHERE metadata->>'upload_id' = OLD.id::text;

  DELETE FROM public.student_documents
  WHERE metadata->>'upload_id' = OLD.id::text;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger to run before upload deletion
DROP TRIGGER IF EXISTS trigger_delete_upload_vectors ON public.uploads;
CREATE TRIGGER trigger_delete_upload_vectors
  BEFORE DELETE ON public.uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_upload_vectors();
