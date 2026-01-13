import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/client';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

async function ensureAuthenticated() {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');

  if (!authCookie || authCookie.value !== 'authenticated') {
    return false;
  }

  return true;
}

export async function GET(req: NextRequest) {
  if (!(await ensureAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('metadata_fields')
    .select('*')
    .eq('user_id', DEMO_USER_ID)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fields: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await ensureAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fieldName, exampleValue } = await req.json();
  if (!fieldName) {
    return NextResponse.json({ error: 'Field name is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('metadata_fields').insert({
    user_id: DEMO_USER_ID,
    field_name: fieldName,
    example_value: exampleValue || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await ensureAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: 'Field id is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('metadata_fields')
    .delete()
    .eq('id', id)
    .eq('user_id', DEMO_USER_ID);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
