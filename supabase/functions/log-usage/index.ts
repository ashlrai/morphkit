// Morphkit Usage Logging Edge Function
// Records each generation attempt for metering

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const apiKey = authHeader.slice(7)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Look up user from API key
  const keyHash = await hashApiKey(apiKey)
  const { data: keyRecord } = await supabase
    .from('api_keys')
    .select('user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single()

  if (!keyRecord) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Parse request body
  let body: { source_repo?: string; status?: string; tokens_used?: number; generation_time_ms?: number }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const status = body.status ?? 'success'
  if (!['success', 'failed', 'quota_exceeded'].includes(status)) {
    return new Response(JSON.stringify({ error: 'Invalid status value' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Insert usage log
  const { error: insertError } = await supabase
    .from('usage_logs')
    .insert({
      user_id: keyRecord.user_id,
      source_repo: body.source_repo ?? null,
      status,
      tokens_used: body.tokens_used ?? 0,
      generation_time_ms: body.generation_time_ms ?? null,
    })

  if (insertError) {
    return new Response(JSON.stringify({ error: 'Failed to log usage' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({ ok: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
