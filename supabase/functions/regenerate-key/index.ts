// Morphkit API Key Regeneration Edge Function
// Revokes the current API key and issues a new one

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

  // Hash the existing key and look it up
  const keyHash = await hashApiKey(apiKey)

  const { data: keyRecord, error: keyError } = await supabase
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single()

  if (keyError || !keyRecord) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Revoke the current key
  const { error: revokeError } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyRecord.id)

  if (revokeError) {
    console.error('Failed to revoke key:', revokeError)
    return new Response(JSON.stringify({ error: 'Failed to revoke current key' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Generate a new API key: morphkit_sk_ + 32 random hex chars
  const randomBytes = new Uint8Array(16)
  crypto.getRandomValues(randomBytes)
  const hexString = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const newPlaintextKey = `morphkit_sk_${hexString}`

  // Hash the new key for storage
  const newKeyHash = await hashApiKey(newPlaintextKey)
  const keyPrefix = newPlaintextKey.slice(0, 16) // morphkit_sk_xxxx

  // Store the new key
  const { error: insertError } = await supabase
    .from('api_keys')
    .insert({
      user_id: keyRecord.user_id,
      key_hash: newKeyHash,
      key_prefix: keyPrefix,
      name: 'Default',
    })

  if (insertError) {
    console.error('Failed to insert new key:', insertError)
    return new Response(JSON.stringify({ error: 'Failed to create new key' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({
      api_key: newPlaintextKey,
      key_prefix: keyPrefix,
      message: 'Key regenerated successfully. Store this key securely — it will not be shown again.',
    }),
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
