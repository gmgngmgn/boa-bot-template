# Links Upload & Content Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add link uploads with RAG embeddings and hybrid search (instant filter + semantic) to the content dashboard.

**Architecture:** Links stored in new `links` table with embeddings for RAG. Search combines client-side filtering with server-side semantic search using existing `search_documents` pattern. Links display in DocumentsTable alongside documents.

**Tech Stack:** Next.js 16, Supabase (pgvector), OpenAI text-embedding-3-small, @ai-sdk/openai, React

---

## Task 1: Create Links Database Table

**Files:**
- Create: `adr/migrations/003_create_links_table.sql`

**Step 1: Write the migration SQL**

```sql
-- =====================================================
-- Links Table Migration
-- =====================================================
-- Stores external links as searchable reference resources

CREATE TABLE IF NOT EXISTS public.links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
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
```

**Step 2: Run migration in Supabase**

Go to Supabase Dashboard > SQL Editor > Run the migration

**Step 3: Commit**

```bash
git add adr/migrations/003_create_links_table.sql
git commit -m "feat: add links table migration with embedding support"
```

---

## Task 2: Create Links API - POST endpoint

**Files:**
- Create: `app/api/links/route.ts`

**Step 1: Create the POST endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';

const getSupabaseAdmin = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
};

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = '00000000-0000-0000-0000-000000000001';
  const { name, url, description, associatedDocumentIds } = await request.json();

  if (!name || !url) {
    return NextResponse.json({ error: 'Name and URL are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    // Generate embedding from name + description
    const textToEmbed = description ? `${name} ${description}` : name;

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const openai = createOpenAI({ apiKey: openaiKey });
    const model = openai.embedding('text-embedding-3-small');
    const { embedding } = await embed({ model, value: textToEmbed });

    // Insert link
    const { data, error } = await supabase
      .from('links')
      .insert({
        user_id: userId,
        name,
        url,
        description: description || null,
        associated_document_ids: associatedDocumentIds || [],
        embedding,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create link:', error);
      return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error creating link:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = '00000000-0000-0000-0000-000000000001';
  const supabase = getSupabaseAdmin();

  const { searchParams } = new URL(request.url);
  const from = parseInt(searchParams.get('from') || '0');
  const to = parseInt(searchParams.get('to') || '9');

  const { data, error, count } = await supabase
    .from('links')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch links' }, { status: 500 });
  }

  return NextResponse.json({ data, count });
}
```

**Step 2: Verify endpoint works**

Start dev server and test with curl:
```bash
curl -X POST http://localhost:3000/api/links \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-session=authenticated" \
  -d '{"name":"Test Link","url":"https://example.com"}'
```

**Step 3: Commit**

```bash
git add app/api/links/route.ts
git commit -m "feat: add links API with POST and GET endpoints"
```

---

## Task 3: Create Links API - DELETE endpoint

**Files:**
- Create: `app/api/links/[id]/route.ts`

**Step 1: Create the DELETE endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

const getSupabaseAdmin = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const userId = '00000000-0000-0000-0000-000000000001';
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('links')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: 'Failed to delete link' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

**Step 2: Commit**

```bash
git add app/api/links/[id]/route.ts
git commit -m "feat: add DELETE endpoint for links"
```

---

## Task 4: Create LinkUpload Component

**Files:**
- Create: `components/dashboard/LinkUpload.tsx`

**Step 1: Create the component**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Link as LinkIcon, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

type Document = {
  id: string;
  filename: string;
  source_type: string;
};

export function LinkUpload() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  // Document selection state
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    const { data } = await supabase
      .from('documents')
      .select('id, filename, source_type')
      .order('created_at', { ascending: false })
      .limit(100);

    if (data) setDocuments(data);
  };

  const filteredDocs = documents.filter(doc =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleDoc = (id: string) => {
    setSelectedDocs(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) return;

    setLoading(true);
    try {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          description: description || undefined,
          associatedDocumentIds: selectedDocs.length > 0 ? selectedDocs : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save link');
      }

      toast.success('Link saved', {
        description: 'Your link has been added and is now searchable.',
      });

      router.push('/dashboard/content');
    } catch (error) {
      toast.error('Failed to save link', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Add a Link</h2>
        <p className="text-sm text-gray-500">Save external links as searchable resources.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-gray-50 rounded-xl p-8 border border-gray-200">
          <div className="w-16 h-16 bg-white rounded-full shadow-sm border border-gray-100 flex items-center justify-center mx-auto mb-6">
            <LinkIcon className="h-8 w-8 text-gray-600" />
          </div>

          <div className="max-w-md mx-auto space-y-4">
            <div className="space-y-2">
              <Label htmlFor="link-name" className="text-sm font-medium text-gray-700">
                Link Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="link-name"
                type="text"
                placeholder="e.g., TSL Framework - Direct Lead"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-white border-gray-200 h-10"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-url" className="text-sm font-medium text-gray-700">
                URL <span className="text-red-500">*</span>
              </Label>
              <Input
                id="link-url"
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-white border-gray-200 h-10"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-description" className="text-sm font-medium text-gray-700">
                Description <span className="text-gray-400">(optional)</span>
              </Label>
              <Input
                id="link-description"
                type="text"
                placeholder="Brief description for better search matching"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-white border-gray-200 h-10"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                Associated Content <span className="text-gray-400">(optional)</span>
              </Label>
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Search documents to associate..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setDropdownOpen(true)}
                  className="bg-white border-gray-200 h-10"
                />
                {dropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredDocs.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">No documents found</div>
                    ) : (
                      filteredDocs.map(doc => (
                        <div
                          key={doc.id}
                          className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleDoc(doc.id)}
                        >
                          <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                            selectedDocs.includes(doc.id) ? 'bg-black border-black' : 'border-gray-300'
                          }`}>
                            {selectedDocs.includes(doc.id) && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className="text-sm truncate">{doc.filename}</span>
                        </div>
                      ))
                    )}
                    <div className="border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setDropdownOpen(false)}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {selectedDocs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedDocs.map(id => {
                    const doc = documents.find(d => d.id === id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs"
                      >
                        {doc?.filename.slice(0, 20)}...
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-red-500"
                          onClick={() => toggleDoc(id)}
                        />
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!name || !url || loading}
            className="bg-black hover:bg-gray-800 text-white shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Link'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/dashboard/LinkUpload.tsx
git commit -m "feat: add LinkUpload component with searchable multi-select"
```

---

## Task 5: Add Links Tab to Upload Page

**Files:**
- Modify: `app/dashboard/transcribe/page.tsx`

**Step 1: Import and add the links tab**

Add import at top:
```typescript
import { LinkUpload } from '@/components/dashboard/LinkUpload';
```

Update the tabs array in the TabsList to include 'links':
```typescript
{['video', 'audio', 'documents', 'youtube', 'links'].map((tab) => (
```

Add the TabsContent for links after the youtube tab:
```typescript
<TabsContent value="links" className="mt-0 focus-visible:outline-none">
  <LinkUpload />
</TabsContent>
```

**Step 2: Verify the tab appears and works**

Run dev server, navigate to /dashboard/transcribe, verify Links tab is present

**Step 3: Commit**

```bash
git add app/dashboard/transcribe/page.tsx
git commit -m "feat: add links tab to upload page"
```

---

## Task 6: Update DocumentsTable to Show Links

**Files:**
- Modify: `components/dashboard/DocumentsTable.tsx`

**Step 1: Add Link type and state**

Add type after Document type:
```typescript
type Link = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  description: string | null;
  associated_document_ids: string[];
  created_at: string;
};

type ContentItem =
  | (Document & { itemType: 'document' })
  | (Link & { itemType: 'link' });
```

**Step 2: Add links state and fetching**

Add state:
```typescript
const [links, setLinks] = useState<Link[]>([]);
const [contentType, setContentType] = useState<'all' | 'documents' | 'links'>('all');
```

Add fetchLinks function:
```typescript
const fetchLinks = async () => {
  const { data, error } = await supabase
    .from('links')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) setLinks(data);
};
```

Call in useEffect after fetchDocuments:
```typescript
fetchLinks();
```

Subscribe to links changes too:
```typescript
const linksChannel = supabase
  .channel('links')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'links',
  }, () => {
    fetchLinks();
  })
  .subscribe();
```

**Step 3: Add type filter dropdown to toolbar**

Add after the date filters:
```typescript
<select
  value={contentType}
  onChange={(e) => setContentType(e.target.value as any)}
  className="h-9 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
>
  <option value="all">All Types</option>
  <option value="documents">Documents</option>
  <option value="links">Links</option>
</select>
```

**Step 4: Combine and filter content**

Add combined content logic before the return:
```typescript
const allContent: ContentItem[] = [
  ...documents.map(d => ({ ...d, itemType: 'document' as const })),
  ...links.map(l => ({ ...l, itemType: 'link' as const })),
].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

const filteredContent = contentType === 'all'
  ? allContent
  : allContent.filter(item =>
      contentType === 'documents' ? item.itemType === 'document' : item.itemType === 'link'
    );
```

**Step 5: Update table rendering**

Add Link icon import:
```typescript
import { ..., Link as LinkIcon } from 'lucide-react';
```

Update table body to handle both types:
```typescript
{filteredContent.map((item) => (
  <tr key={item.id} className="hover:bg-gray-50/50 transition-colors group">
    <td className="p-4">
      <Checkbox
        checked={selected.has(item.id)}
        onCheckedChange={(checked) => handleSelect(item.id, checked as boolean)}
      />
    </td>
    <td className="p-4 font-mono text-xs text-gray-500">
      {item.id.slice(0, 8)}...
    </td>
    <td className="p-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
          {item.itemType === 'link' ? <LinkIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </div>
        <span className="font-medium text-gray-900 truncate max-w-[300px]">
          {item.itemType === 'link' ? item.name : item.filename}
        </span>
      </div>
    </td>
    <td className="p-4">
      {item.itemType === 'link' ? (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-100">
          Link
        </span>
      ) : (
        getStatusBadge(item.status)
      )}
    </td>
    <td className="p-4 text-gray-500">
      {format(new Date(item.created_at), 'MMM d, yyyy • h:mm a')}
    </td>
    <td className="p-4">
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-2">
        {item.itemType === 'link' ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => window.open(item.url, '_blank')}
            >
              Open
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={async () => {
                if (confirm('Delete this link?')) {
                  await fetch(`/api/links/${item.id}`, { method: 'DELETE' });
                  fetchLinks();
                }
              }}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => handleIngest(item)}
              disabled={item.status !== 'completed'}
            >
              Ingest
            </Button>
            <DropdownMenu>
              {/* existing dropdown menu */}
            </DropdownMenu>
          </>
        )}
      </div>
    </td>
  </tr>
))}
```

**Step 6: Commit**

```bash
git add components/dashboard/DocumentsTable.tsx
git commit -m "feat: display links in DocumentsTable with type filter"
```

---

## Task 7: Create Search API Endpoint

**Files:**
- Create: `app/api/search/route.ts`

**Step 1: Create semantic search endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';

const getSupabaseAdmin = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
};

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  const userId = '00000000-0000-0000-0000-000000000001';
  const supabase = getSupabaseAdmin();

  try {
    // Generate embedding for query
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const openai = createOpenAI({ apiKey: openaiKey });
    const model = openai.embedding('text-embedding-3-small');
    const { embedding } = await embed({ model, value: query });

    // Search documents
    const { data: docResults, error: docError } = await supabase.rpc('search_documents', {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: 10,
      filter_user_id: userId,
    });

    // Search links
    const { data: linkResults, error: linkError } = await supabase.rpc('search_links', {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: 10,
      filter_user_id: userId,
    });

    // Combine and format results
    const results = [
      ...(docResults || []).map((r: any) => ({
        id: r.id,
        type: 'document' as const,
        name: r.metadata?.filename || 'Document',
        content: r.content,
        similarity: r.similarity,
        metadata: r.metadata,
      })),
      ...(linkResults || []).map((r: any) => ({
        id: r.id,
        type: 'link' as const,
        name: r.name,
        url: r.url,
        content: r.description || r.name,
        similarity: r.similarity,
      })),
    ].sort((a, b) => b.similarity - a.similarity);

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add app/api/search/route.ts
git commit -m "feat: add semantic search API endpoint"
```

---

## Task 8: Add Search UI to DocumentsTable

**Files:**
- Modify: `components/dashboard/DocumentsTable.tsx`
- Create: `components/dashboard/SearchResults.tsx`

**Step 1: Create SearchResults component**

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { X, FileText, Link as LinkIcon, ExternalLink } from 'lucide-react';

type SearchResult = {
  id: string;
  type: 'document' | 'link';
  name: string;
  url?: string;
  content: string;
  similarity: number;
  metadata?: any;
};

type Props = {
  results: SearchResult[];
  query: string;
  onClose: () => void;
  loading: boolean;
};

export function SearchResults({ results, query, onClose, loading }: Props) {
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <span className="ml-3 text-gray-600">Searching...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Search Results</h2>
            <p className="text-sm text-gray-500">
              {results.length} results for "{query}"
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {results.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No results found. Try a different search term.
            </div>
          ) : (
            results.map((result) => (
              <div
                key={result.id}
                className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0">
                    {result.type === 'link' ? (
                      <LinkIcon className="h-4 w-4" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">
                        {result.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">
                        {Math.round(result.similarity * 100)}% match
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                      {result.content}
                    </p>
                    {result.type === 'link' && result.url && (
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2"
                      >
                        Open link <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add search to DocumentsTable toolbar**

Add imports:
```typescript
import { Search } from 'lucide-react';
import { SearchResults } from './SearchResults';
```

Add state:
```typescript
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState<any[]>([]);
const [showSearchResults, setShowSearchResults] = useState(false);
const [searching, setSearching] = useState(false);
```

Add search function:
```typescript
const handleSearch = async () => {
  if (!searchQuery.trim()) return;

  setSearching(true);
  setShowSearchResults(true);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
    const data = await res.json();
    setSearchResults(data.results || []);
  } catch (error) {
    console.error('Search failed:', error);
  } finally {
    setSearching(false);
  }
};
```

Add to toolbar (before the date filters):
```typescript
<div className="flex items-center gap-2">
  <input
    type="text"
    placeholder="Search content..."
    value={searchQuery}
    onChange={(e) => {
      setSearchQuery(e.target.value);
      // Instant filter on documents/links by name
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') handleSearch();
    }}
    className="h-9 w-64 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
  />
  <Button
    variant="outline"
    size="sm"
    onClick={handleSearch}
    disabled={!searchQuery.trim()}
    className="h-9"
  >
    <Search className="h-4 w-4" />
  </Button>
</div>
```

Add SearchResults modal at end of component (before closing div):
```typescript
{showSearchResults && (
  <SearchResults
    results={searchResults}
    query={searchQuery}
    loading={searching}
    onClose={() => {
      setShowSearchResults(false);
      setSearchResults([]);
    }}
  />
)}
```

**Step 3: Add instant filter functionality**

Add filtered content with search:
```typescript
const displayContent = searchQuery && !showSearchResults
  ? filteredContent.filter(item => {
      const name = item.itemType === 'link' ? item.name : item.filename;
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    })
  : filteredContent;
```

Use `displayContent` in the table body instead of `filteredContent`.

**Step 4: Commit**

```bash
git add components/dashboard/SearchResults.tsx components/dashboard/DocumentsTable.tsx
git commit -m "feat: add hybrid search with instant filter and semantic search modal"
```

---

## Task 9: Final Testing & Cleanup

**Step 1: Test all features**

1. Navigate to /dashboard/transcribe
2. Click Links tab
3. Add a link with name, URL, description
4. Associate with existing documents (optional)
5. Save and verify redirect to content page
6. Verify link appears in table with link icon
7. Test type filter dropdown
8. Test instant search filter by typing
9. Test semantic search by pressing Enter
10. Test Open and Delete actions on links

**Step 2: Fix any issues found**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete links upload and search implementation"
```

---

## Summary

**New files created:**
- `adr/migrations/003_create_links_table.sql`
- `app/api/links/route.ts`
- `app/api/links/[id]/route.ts`
- `app/api/search/route.ts`
- `components/dashboard/LinkUpload.tsx`
- `components/dashboard/SearchResults.tsx`

**Modified files:**
- `app/dashboard/transcribe/page.tsx`
- `components/dashboard/DocumentsTable.tsx`
