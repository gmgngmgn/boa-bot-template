import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

Deno.serve(async (req) => {
  const { query } = await req.json();

  const openai = new OpenAI({ apiKey: openaiApiKey });

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
    dimensions: 1536
  });

  const [{ embedding }] = embeddingResponse.data;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { data: student_documents } = await supabase.rpc('student_hybrid_search', {
    query_text: query,
    query_embedding: embedding,
    match_count: 10
  });

  return new Response(JSON.stringify(student_documents), {
    headers: { 'Content-Type': 'application/json' }
  });
});
