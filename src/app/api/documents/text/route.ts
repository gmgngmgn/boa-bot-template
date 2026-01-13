import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = '00000000-0000-0000-0000-000000000001';

  try {
    const { title, content } = await request.json();

    if (!title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const documentId = uuidv4();

    // Create upload record with status 'completed' since text doesn't need transcription
    const { error: dbError } = await admin
      .from('uploads')
      .insert({
        id: documentId,
        user_id: userId,
        filename: title.trim(),
        source_type: 'document',
        source_url: null,
        status: 'completed',
        transcript_text: content.trim(),
        metadata: {
          type: 'freeform_text',
          word_count: content.trim().split(/\s+/).filter(Boolean).length,
          char_count: content.length,
        },
      });

    if (dbError) {
      console.error('DB error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, documentId });
  } catch (error) {
    console.error('Text upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save text' },
      { status: 500 }
    );
  }
}
