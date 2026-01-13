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
-- 12. LINKS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  associated_document_ids UUID[] DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_links_user_id ON public.links(user_id);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON public.links(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_embedding ON public.links USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to links" ON public.links FOR ALL USING (true);

DROP TRIGGER IF EXISTS update_links_updated_at ON public.links;
CREATE TRIGGER update_links_updated_at
  BEFORE UPDATE ON public.links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Search function for links
CREATE OR REPLACE FUNCTION public.search_links(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  filter_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  url text,
  description text,
  associated_document_ids uuid[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    links.id,
    links.name,
    links.url,
    links.description,
    links.associated_document_ids,
    1 - (links.embedding <=> query_embedding) as similarity
  FROM public.links
  WHERE
    (filter_user_id IS NULL OR links.user_id = filter_user_id)
    AND links.embedding IS NOT NULL
    AND 1 - (links.embedding <=> query_embedding) > match_threshold
  ORDER BY links.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =====================================================
-- 13. CASCADE DELETE FOR UPLOADS (Optimized)
-- =====================================================
-- Uses tracked vector_ids only, no slow metadata scans
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

  -- Note: Removed slow metadata-based delete queries that caused timeouts
  -- The upload_vectors table tracks all vector IDs for proper cleanup

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_delete_upload_vectors ON public.uploads;
CREATE TRIGGER trigger_delete_upload_vectors
  BEFORE DELETE ON public.uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_upload_vectors();

-- =====================================================
-- 14. DELETE_UPLOAD_COMPLETE RPC FUNCTION
-- =====================================================
-- Single RPC call to delete upload and all associated data
CREATE OR REPLACE FUNCTION public.delete_upload_complete(p_upload_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_url TEXT;
  v_tracking RECORD;
  v_deleted_vectors INT := 0;
BEGIN
  -- Get source_url from uploads for storage cleanup later
  SELECT source_url INTO v_source_url FROM uploads WHERE id = p_upload_id;

  -- Get tracking record
  SELECT * INTO v_tracking FROM upload_vectors WHERE upload_id = p_upload_id;

  -- Delete vectors if tracking exists
  IF v_tracking.id IS NOT NULL AND v_tracking.vector_ids IS NOT NULL THEN
    IF v_tracking.target_table = 'student_documents' THEN
      DELETE FROM student_documents WHERE id = ANY(v_tracking.vector_ids);
    ELSE
      DELETE FROM documents WHERE id = ANY(v_tracking.vector_ids);
    END IF;
    GET DIAGNOSTICS v_deleted_vectors = ROW_COUNT;

    -- Delete tracking record
    DELETE FROM upload_vectors WHERE id = v_tracking.id;
  END IF;

  -- Delete the upload record
  DELETE FROM uploads WHERE id = p_upload_id;

  RETURN json_build_object(
    'success', true,
    'deleted_vectors', v_deleted_vectors,
    'source_url', v_source_url
  );
END;
$$;

-- =====================================================
-- 15. STORAGE BUCKET
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 16. ENABLE REALTIME
-- =====================================================
-- Enable realtime updates for uploads and links tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.uploads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.links;

-- =====================================================
-- SETUP COMPLETE
-- =====================================================
