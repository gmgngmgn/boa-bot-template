import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');
  
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('uploads')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (from) {
    query = query.gte('created_at', from);
  }
  if (to) {
    query = query.lte('created_at', to);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    documents: data,
    total: count || 0,
    page,
    limit,
  });
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { documentIds } = await request.json();
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return NextResponse.json({ error: 'documentIds array required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  let deletedUploads = 0;
  let deletedVectorCount = 0;
  const deleteErrors: string[] = [];
  const storagePaths: string[] = [];

  // Use single RPC call per document to handle everything in one database transaction
  for (const docId of documentIds) {
    console.log(`Attempting to delete upload: ${docId}`);

    const { data, error } = await supabase.rpc('delete_upload_complete', {
      p_upload_id: docId
    });

    if (error) {
      console.error(`Failed to delete upload ${docId}:`, error);
      deleteErrors.push(`${docId}: ${error.message} (code: ${error.code})`);
    } else {
      console.log(`Successfully deleted upload: ${docId}, result:`, data);
      deletedUploads++;
      if (data?.deleted_vectors) {
        deletedVectorCount += data.deleted_vectors;
      }
      if (data?.source_url) {
        storagePaths.push(data.source_url);
      }
    }
  }

  // Delete from storage (separate from database)
  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from('documents')
      .remove(storagePaths);

    if (storageError) {
      console.error('Storage delete error (non-fatal):', storageError.message);
    }
  }

  if (deletedUploads === 0 && deleteErrors.length > 0) {
    return NextResponse.json({
      error: 'Failed to delete uploads',
      details: deleteErrors
    }, { status: 500 });
  }

  return NextResponse.json({ deleted: deletedUploads, deletedVectors: deletedVectorCount });
}

