import { NextRequest, NextResponse } from 'next/server';
import { tasks } from '@trigger.dev/sdk/v3';
import { createClient } from '@supabase/supabase-js';

const getSupabaseAdmin = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
};

export async function POST(req: NextRequest) {
  try {
    const { uploadId } = await req.json();

    if (!uploadId) {
      return NextResponse.json({ error: 'Upload ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Get the upload record
    const { data: upload, error } = await supabase
      .from('uploads')
      .select('*')
      .eq('id', uploadId)
      .single();

    if (error || !upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    // Check if it has a Google Doc URL stored
    const googleDocUrl = upload.metadata?.google_doc_url;
    if (!googleDocUrl) {
      return NextResponse.json({ error: 'No Google Doc URL found for retry' }, { status: 400 });
    }

    const userId = '00000000-0000-0000-0000-000000000001';
    const targetTable = upload.metadata?.target_table || 'documents';

    // Reset status to processing
    await supabase
      .from('uploads')
      .update({
        status: 'processing',
        metadata: { ...upload.metadata, progress: 0, error: null },
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId);

    // Trigger the row processing task
    await tasks.trigger('process-csv-row', {
      uploadId,
      userId,
      documentName: upload.filename,
      docUrl: googleDocUrl,
      externalLink: upload.metadata?.external_link,
      targetTable,
      isRetry: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Retry CSV row error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
