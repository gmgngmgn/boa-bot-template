import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use the admin user ID created in migration
  const userId = '00000000-0000-0000-0000-000000000001';

  const body = await request.json();
  const { uploads } = body as {
    uploads: Array<{
      documentId: string;
      filename: string;
      storagePath: string;
      sourceType: 'video' | 'audio' | 'document';
      size: number;
    }>;
  };

  if (!uploads || uploads.length === 0) {
    return NextResponse.json({ error: 'No uploads provided' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const documentIds: string[] = [];

  for (const upload of uploads) {
    // Create upload record
    const { error: dbError } = await admin
      .from('uploads')
      .insert({
        id: upload.documentId,
        user_id: userId,
        filename: upload.filename,
        source_type: upload.sourceType,
        source_url: upload.storagePath,
        status: 'processing',
        metadata: { progress: 0, size: upload.size },
      });

    if (dbError) {
      console.error('DB error:', dbError);
      continue;
    }

    documentIds.push(upload.documentId);
  }

  return NextResponse.json({
    documentIds,
  });
}
