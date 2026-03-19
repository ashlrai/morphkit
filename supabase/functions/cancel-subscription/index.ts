// Morphkit Subscription Cancellation Edge Function
// Cancels the user's Stripe subscription at period end

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://morphkit.dev',
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

  // Hash the API key and look up the user
  const keyHash = await hashApiKey(apiKey)

  const { data: keyRecord, error: keyError } = await supabase
    .from('api_keys')
    .select('user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single()

  if (keyError || !keyRecord) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Look up the user's active subscription
  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select('id, stripe_subscription_id, tier, status, current_period_end')
    .eq('user_id', keyRecord.user_id)
    .eq('status', 'active')
    .single()

  if (subError || !subscription) {
    return new Response(JSON.stringify({ error: 'No active subscription found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (subscription.tier === 'free') {
    return new Response(JSON.stringify({ error: 'Cannot cancel a free tier subscription' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!subscription.stripe_subscription_id) {
    return new Response(JSON.stringify({ error: 'No Stripe subscription linked to this account' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Cancel the Stripe subscription at period end
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-12-18.acacia',
  })

  let canceledSubscription: Stripe.Subscription
  try {
    canceledSubscription = await stripe.subscriptions.update(
      subscription.stripe_subscription_id,
      { cancel_at_period_end: true },
    )
  } catch (err) {
    console.error('Stripe cancellation failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown Stripe error'
    return new Response(JSON.stringify({ error: 'Failed to cancel subscription', detail: message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Update the subscription status in the database
  const cancelDate = new Date(canceledSubscription.current_period_end * 1000).toISOString()

  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      current_period_end: cancelDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id)

  if (updateError) {
    console.error('Failed to update subscription record:', updateError)
    // Stripe cancellation succeeded, so still return success
  }

  return new Response(
    JSON.stringify({
      message: 'Subscription canceled. You will retain access until the end of your billing period.',
      cancel_at: cancelDate,
      tier: subscription.tier,
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
