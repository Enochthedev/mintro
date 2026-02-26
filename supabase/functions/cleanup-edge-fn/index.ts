// functions/cleanup-edge-fn/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var');
// If you want to fail fast during deploy, you can throw here.
}
/**
 * Supabase Edge Functions expose a default handler that receives a Request.
 * This runs server-side at the edge and is safe to call from scheduled jobs.
 */ export default (async (req)=>{
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        // for edge functions we often don't need browser-specific auth
        persistSession: false
      }
    });
    // Call the RPC cleanup function (returns { data, error })
    const { data, error } = await supabase.rpc('cleanup_old_link_tokens');
    if (error) {
      console.error('cleanup_old_link_tokens RPC error:', error);
      return new Response(JSON.stringify({
        ok: false,
        error: error.message ?? error
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      deleted: data ?? null
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('Edge function failed:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: String(err)
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
