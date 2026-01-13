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

  // Use the admin user ID created in migration
  const userId = '00000000-0000-0000-0000-000000000001';

  const formData = await request.formData();
  const files = formData.getAll('files') as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const documentIds: string[] = [];
  const uploadUrls: string[] = [];

  for (const file of files) {
    const documentId = uuidv4();
    const storagePath = `${userId}/${documentId}/${file.name}`;

    // Upload to storage
    const { error: uploadError } = await admin.storage
      .from('uploads')
      .upload(storagePath, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      continue;
    }

    // Determine source type from file extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    let sourceType: 'video' | 'audio' | 'document' = 'document';
    if (['mp4', 'mov', 'avi'].includes(ext || '')) {
      sourceType = 'video';
    } else if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext || '')) {
      sourceType = 'audio';
    }

    // Create document record
    const { error: dbError } = await admin
      .from('uploads')
      .insert({
        id: documentId,
        user_id: userId,
        filename: file.name,
        source_type: sourceType,
        source_url: storagePath,
        status: 'processing',
        metadata: { progress: 0 },
      });

    if (dbError) {
      console.error('DB error:', dbError);
      continue;
    }

    documentIds.push(documentId);
    uploadUrls.push(storagePath);
  }

  return NextResponse.json({
    documentIds,
    uploadUrls,
  });
}

