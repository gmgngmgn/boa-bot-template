import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function guessContentType(path: string): string {
  const lower = (path || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'text/markdown; charset=utf-8';
  }
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bucket = searchParams.get('bucket') || 'documents';
    const pathRaw = searchParams.get('path') || '';
    const path = decodeURIComponent(pathRaw);

    if (!bucket || !path) {
      return NextResponse.json({ error: 'bucket and path are required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.storage.from(bucket).download(path);

    if (error || !data) {
      return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 });
    }

    const blob = data as Blob;
    const arrayBuffer = await blob.arrayBuffer();
    const contentType = (blob as any).type || guessContentType(path);
    const filename = path.split('/').pop() || 'file';

    return new NextResponse(arrayBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to proxy file' },
      { status: 500 }
    );
  }
}
