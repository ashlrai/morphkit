// Morphkit API Key Validation Edge Function
// Validates API keys and checks usage quota

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const FREE_TIER_LIMIT = 20 // conversions per month

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
    return new Response(JSON.stringify({ error: 'Missing API key' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const apiKey = authHeader.slice(7)

  // Validate key format
  if (!apiKey.startsWith('morphkit_sk_')) {
    return new Response(JSON.stringify({ error: 'Invalid API key format' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Hash the API key to match against stored hashes
  const keyHash = await hashApiKey(apiKey)

  // Look up the key
  const { data: keyRecord, error: keyError } = await supabase
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', keyHash)
    .single()

  if (keyError || !keyRecord) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Check if key is revoked
  if (keyRecord.revoked_at) {
    return new Response(JSON.stringify({ error: 'API key has been revoked' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Update last_used_at
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRecord.id)

  // Get subscription tier
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', keyRecord.user_id)
    .eq('status', 'active')
    .single()

  const tier = subscription?.tier ?? 'free'

  // Check usage quota for free tier
  if (tier === 'free') {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const { count } = await supabase
      .from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', keyRecord.user_id)
      .eq('status', 'success')
      .gte('timestamp', startOfMonth.toISOString())

    const used = count ?? 0
    const remaining = Math.max(0, FREE_TIER_LIMIT - used)

    if (remaining === 0) {
      return new Response(
        JSON.stringify({
          error: 'Monthly quota exceeded',
          tier,
          remaining: 0,
          upgrade_url: 'https://morphkit.dev/pricing',
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    return new Response(
      JSON.stringify({ tier, remaining }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Pro/Enterprise: unlimited
  return new Response(
    JSON.stringify({ tier, remaining: -1 }),
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
