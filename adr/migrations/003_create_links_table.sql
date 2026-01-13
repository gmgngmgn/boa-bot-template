-- =====================================================
-- Links Table Migration
-- =====================================================
-- Stores external links as searchable reference resources

CREATE TABLE IF NOT EXISTS public.links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  associated_document_ids UUID[] DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_links_user_id ON public.links(user_id);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON public.links(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_embedding ON public.links USING hnsw (embedding vector_cosine_ops);

-- RLS
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;

-- Policies (using service role for now, same as documents pattern)
CREATE POLICY "Service role full access to links"
  ON public.links FOR ALL
  USING (true);

-- Updated_at trigger
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
