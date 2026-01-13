import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tasks } from '@trigger.dev/sdk/v3';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');
  
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = '00000000-0000-0000-0000-000000000001';
  const { documentId, targetTable, externalLink } = await request.json();

  if (!documentId) {
    return NextResponse.json({ error: 'Document ID required' }, { status: 400 });
  }

  // Trigger ingestion task
  const handle = await tasks.trigger('ingest-document', {
    userId,
    documentId,
    targetTable: targetTable || 'documents',
    externalLink: externalLink || undefined,
  });

  return NextResponse.json({ taskId: handle.id });
}

