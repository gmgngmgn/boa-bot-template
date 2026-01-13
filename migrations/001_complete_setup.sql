-- =====================================================
-- Complete Setup Migration
-- =====================================================
-- This migration creates all tables, functions, and
-- policies needed for the document ingestion system.
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- 1. DOCUMENTS TABLE (Main Knowledge Base)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.documents (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  content TEXT,
  embedding vector(1536),
  metadata JSONB,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS idx_documents_embedding ON public.documents
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_documents_fts ON public.documents USING gin(fts);

-- =====================================================
-- 2. STUDENT_DOCUMENTS TABLE (Student Knowledge Base)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.student_documents (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  content TEXT,
  embedding vector(1536),
  metadata JSONB,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS idx_student_documents_embedding ON public.student_documents
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_student_documents_fts ON public.student_documents USING gin(fts);

-- =====================================================
-- 3. CHAT TABLE (Conversation History)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.chat (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR NOT NULL,
  message JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_session_id ON public.chat(session_id);

-- =====================================================
-- 4. Create Admin User
-- =====================================================
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
  'admin@local.dev',
  '',
  now(),
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 5. UPLOADS TABLE
-- =====================================================
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

CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON public.uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON public.uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON public.uploads(created_at DESC);

-- =====================================================
-- 6. UPLOAD_VECTORS TABLE
-- =====================================================
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

CREATE INDEX IF NOT EXISTS idx_upload_vectors_upload_id ON public.upload_vectors(upload_id);

-- =====================================================
-- 7. METADATA_FIELDS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.metadata_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  field_name TEXT NOT NULL,
  example_value TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metadata_fields_user_id ON public.metadata_fields(user_id);

-- =====================================================
-- 8. ENABLE RLS
-- =====================================================
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_fields ENABLE ROW LEVEL SECURITY;

-- Service role policies (full access)
CREATE POLICY "Service role full access to documents" ON public.documents FOR ALL USING (true);
CREATE POLICY "Service role full access to student_documents" ON public.student_documents FOR ALL USING (true);
CREATE POLICY "Service role full access to uploads" ON public.uploads FOR ALL USING (true);
CREATE POLICY "Service role full access to upload_vectors" ON public.upload_vectors FOR ALL USING (true);
CREATE POLICY "Service role full access to metadata_fields" ON public.metadata_fields FOR ALL USING (true);

-- =====================================================
-- 9. HYBRID_SEARCH FUNCTION (Main Knowledge Base)
-- =====================================================
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text text,
  query_embedding vector,
  match_count integer,
  full_text_weight double precision DEFAULT 1,
  semantic_weight double precision DEFAULT 1,
  rrf_k integer DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  content text,
  metadata jsonb,
  keyword_rank_ix integer,
  semantic_rank_ix integer,
  rrf_score double precision
)
LANGUAGE sql
AS $$
WITH full_text AS (
  SELECT
    documents.id,
    row_number() OVER (ORDER BY ts_rank_cd(fts, websearch_to_tsquery(query_text)) DESC)::integer AS rank_ix
  FROM documents
  WHERE fts @@ websearch_to_tsquery(query_text)
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
semantic AS (
  SELECT
    documents.id,
    row_number() OVER (ORDER BY embedding <#> query_embedding)::integer AS rank_ix
  FROM documents
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
combined AS (
  SELECT
    coalesce(f.id, s.id) AS id,
    f.rank_ix AS keyword_rank_ix,
    s.rank_ix AS semantic_rank_ix
  FROM full_text f
  FULL OUTER JOIN semantic s ON f.id = s.id
)
SELECT
  d.id,
  d.content,
  d.metadata,
  c.keyword_rank_ix,
  c.semantic_rank_ix,
  (coalesce(1.0 / (rrf_k + c.keyword_rank_ix), 0.0) * full_text_weight) +
  (coalesce(1.0 / (rrf_k + c.semantic_rank_ix), 0.0) * semantic_weight) AS rrf_score
FROM combined c
JOIN documents d ON d.id = c.id
ORDER BY rrf_score DESC
LIMIT least(match_count, 30);
$$;

-- =====================================================
-- 10. STUDENT_HYBRID_SEARCH FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION public.student_hybrid_search(
  query_text text,
  query_embedding vector,
  match_count integer,
  full_text_weight double precision DEFAULT 1,
  semantic_weight double precision DEFAULT 1,
  rrf_k integer DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  content text,
  metadata jsonb,
  keyword_rank_ix integer,
  semantic_rank_ix integer,
  rrf_score double precision
)
LANGUAGE sql
AS $$
WITH full_text AS (
  SELECT
    student_documents.id,
    row_number() OVER (ORDER BY ts_rank_cd(fts, websearch_to_tsquery(query_text)) DESC)::integer AS rank_ix
  FROM student_documents
  WHERE fts @@ websearch_to_tsquery(query_text)
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
semantic AS (
  SELECT
    student_documents.id,
    row_number() OVER (ORDER BY embedding <#> query_embedding)::integer AS rank_ix
  FROM student_documents
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
combined AS (
  SELECT
    coalesce(f.id, s.id) AS id,
    f.rank_ix AS keyword_rank_ix,
    s.rank_ix AS semantic_rank_ix
  FROM full_text f
  FULL OUTER JOIN semantic s ON f.id = s.id
)
SELECT
  d.id,
  d.content,
  d.metadata,
  c.keyword_rank_ix,
  c.semantic_rank_ix,
  (coalesce(1.0 / (rrf_k + c.keyword_rank_ix), 0.0) * full_text_weight) +
  (coalesce(1.0 / (rrf_k + c.semantic_rank_ix), 0.0) * semantic_weight) AS rrf_score
FROM combined c
JOIN student_documents d ON d.id = c.id
ORDER BY rrf_score DESC
LIMIT least(match_count, 30);
$$;

-- =====================================================
-- 11. UPDATED_AT TRIGGER
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_uploads_updated_at ON public.uploads;
CREATE TRIGGER update_uploads_updated_at
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_metadata_fields_updated_at ON public.metadata_fields;
CREATE TRIGGER update_metadata_fields_updated_at
  BEFORE UPDATE ON public.metadata_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 12. CASCADE DELETE FOR UPLOADS
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_upload_vectors()
RETURNS TRIGGER AS $$
DECLARE
  tracking_row RECORD;
BEGIN
  FOR tracking_row IN
    SELECT vector_ids, target_table FROM public.upload_vectors WHERE upload_id = OLD.id
  LOOP
    IF tracking_row.target_table = 'documents' THEN
      DELETE FROM public.documents WHERE id = ANY(tracking_row.vector_ids);
    ELSIF tracking_row.target_table = 'student_documents' THEN
      DELETE FROM public.student_documents WHERE id = ANY(tracking_row.vector_ids);
    END IF;
  END LOOP;

  DELETE FROM public.documents WHERE metadata->>'upload_id' = OLD.id::text;
  DELETE FROM public.student_documents WHERE metadata->>'upload_id' = OLD.id::text;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_delete_upload_vectors ON public.uploads;
CREATE TRIGGER trigger_delete_upload_vectors
  BEFORE DELETE ON public.uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_upload_vectors();

-- =====================================================
-- 13. STORAGE BUCKET
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SETUP COMPLETE
-- =====================================================
