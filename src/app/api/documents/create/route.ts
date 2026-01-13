import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');
  
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { documentId, filename, sourceType, storagePath } = await request.json();
  const userId = '00000000-0000-0000-0000-000000000001';

  const admin = getSupabaseAdmin();

  // Create document record
  const { error: dbError } = await admin
    .from('uploads')
    .insert({
      id: documentId,
      user_id: userId,
      filename,
      source_type: sourceType,
      source_url: storagePath,
      status: 'processing',
      metadata: { progress: 0 },
    });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, documentId });
}

