import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { cookies } from 'next/headers';
import { tasks } from '@trigger.dev/sdk/v3';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');
  
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = '00000000-0000-0000-0000-000000000001';

  const { documentIds, sourceType, youtubeUrl } = await request.json();

  const admin = getSupabaseAdmin();
  const taskIds: string[] = [];

  if (sourceType === 'youtube' && youtubeUrl) {
    // Handle YouTube transcription
    const documentId = uuidv4();
    
    // Create document record
    await admin.from('uploads').insert({
      id: documentId,
      user_id: userId,
      filename: `YouTube: ${youtubeUrl}`,
      source_type: 'youtube',
      source_url: youtubeUrl,
      status: 'processing',
      metadata: { progress: 0 },
    });

    // Trigger task
    const handle = await tasks.trigger('youtube-transcript', {
      userId,
      documentId,
      url: youtubeUrl,
    });

    taskIds.push(handle.id);
  } else if (documentIds && Array.isArray(documentIds)) {
    // Handle video/audio/document transcription
    for (const documentId of documentIds) {
      // Get document details
      const { data: doc } = await admin
        .from('uploads')
        .select('*')
        .eq('id', documentId)
        .single();

      if (!doc) continue;

      // Trigger appropriate task
      if (doc.source_type === 'video' || doc.source_type === 'audio') {
        const handle = await tasks.trigger('transcribe-video', {
          userId,
          documentId: doc.id,
          storagePath: doc.source_url!,
          filename: doc.filename,
        });
        taskIds.push(handle.id);
      } else if (doc.source_type === 'document') {
        // For documents, trigger text extraction task (NOT ingestion)
        const handle = await tasks.trigger('extract-document-text', {
          userId,
          documentId: doc.id,
          storagePath: doc.source_url!,
          filename: doc.filename,
        });
        taskIds.push(handle.id);
      }
    }
  }

  return NextResponse.json({ taskIds });
}

