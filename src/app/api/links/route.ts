import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';

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

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
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

    // Auto-ingest: Add to vector_documents for RAG search
    const ragContent = [
      `Link: ${name}`,
      description ? `Description: ${description}` : '',
      `URL: ${url}`,
    ].filter(Boolean).join('\n');

    const { error: vectorError } = await supabase
      .from('vector_documents')
      .insert({
        user_id: userId,
        content: ragContent,
        embedding,
        metadata: {
          link_id: data.id,
          link_name: name,
          link_url: url,
          source_type: 'link',
        },
      });

    if (vectorError) {
      console.error('Failed to auto-ingest link:', vectorError);
      // Don't fail the request, link was still created
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error creating link:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
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
  const fromDate = searchParams.get('from');
  const toDate = searchParams.get('to');

  let query = supabase
    .from('links')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (fromDate) {
    query = query.gte('created_at', `${fromDate}T00:00:00`);
  }
  if (toDate) {
    query = query.lte('created_at', `${toDate}T23:59:59`);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch links' }, { status: 500 });
  }

  return NextResponse.json({ data, count });
}
