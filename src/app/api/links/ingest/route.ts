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
  const { linkId } = await request.json();

  if (!linkId) {
    return NextResponse.json({ error: 'Link ID required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Get the link
  const { data: link, error: linkErr } = await supabase
    .from('links')
    .select('*')
    .eq('id', linkId)
    .eq('user_id', userId)
    .single();

  if (linkErr || !link) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
  }

  try {
    // Create content for RAG - include name, description, and URL
    const content = [
      `Link: ${link.name}`,
      link.description ? `Description: ${link.description}` : '',
      `URL: ${link.url}`,
    ].filter(Boolean).join('\n');

    // Generate embedding
    const openai = createOpenAI({ apiKey: openaiKey });
    const model = openai.embedding('text-embedding-3-small');
    const { embedding } = await embed({ model, value: content });

    // Insert into vector_documents
    const { data: inserted, error: insertErr } = await supabase
      .from('vector_documents')
      .insert({
        user_id: userId,
        content,
        embedding,
        metadata: {
          link_id: linkId,
          link_name: link.name,
          link_url: link.url,
          source_type: 'link',
        },
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('Failed to insert vector:', insertErr);
      return NextResponse.json({ error: 'Failed to ingest link' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      linkId,
      vectorId: inserted.id,
    });

  } catch (error) {
    console.error('Link ingestion error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
