import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';

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

    if (docError) {
      console.error('Document search error:', docError);
    }

    // Search links
    const { data: linkResults, error: linkError } = await supabase.rpc('search_links', {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: 10,
      filter_user_id: userId,
    });

    if (linkError) {
      console.error('Link search error:', linkError);
    }

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
