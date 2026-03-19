// Morphkit Stripe Webhook Handler
// Handles subscription lifecycle events from Stripe

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://morphkit.dev',
  'Access-Control-Allow-Headers': 'authorization, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-12-18.acacia',
})

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

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

  // Verify Stripe signature
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing Stripe signature' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.text()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(supabase, session)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionUpdated(supabase, subscription)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(supabase, subscription)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentFailed(supabase, invoice)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err)
    return new Response(JSON.stringify({ error: 'Webhook handler failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({ received: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
) {
  const customerId = session.customer as string
  const subscriptionId = session.subscription as string
  const userId = session.metadata?.user_id

  if (!userId) {
    console.error('No user_id in checkout session metadata')
    return
  }

  // Determine tier from the price
  const tier = session.metadata?.tier ?? 'pro'

  // Retrieve the Stripe subscription to get period dates
  let periodEnd: string | null = null
  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      periodEnd = new Date(sub.current_period_end * 1000).toISOString()
    } catch (err) {
      console.error('Failed to retrieve subscription period:', err)
    }
  }

  // Upsert subscription record
  await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        tier,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
}

async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
) {
  const stripeSubId = subscription.id
  const status = mapStripeStatus(subscription.status)

  // Determine tier from price metadata or product
  const priceId = subscription.items.data[0]?.price.id
  const tier = priceId ? await inferTierFromPrice(priceId) : 'pro'

  await supabase
    .from('subscriptions')
    .update({
      tier,
      status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', stripeSubId)
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
) {
  // Downgrade to free tier
  await supabase
    .from('subscriptions')
    .update({
      tier: 'free',
      status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id)
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
) {
  const subscriptionId = invoice.subscription as string
  if (!subscriptionId) return

  // Set status to past_due — user gets a grace period
  await supabase
    .from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active': return 'active'
    case 'past_due': return 'past_due'
    case 'canceled': return 'canceled'
    case 'trialing': return 'trialing'
    case 'unpaid': return 'past_due'
    case 'incomplete': return 'past_due'
    case 'incomplete_expired': return 'canceled'
    case 'paused': return 'past_due'
    default: return 'past_due'
  }
}

async function inferTierFromPrice(priceId: string): Promise<string> {
  // Map known price IDs to tiers
  // In production, these would be configured via env vars
  const proPriceId = Deno.env.get('STRIPE_PRO_PRICE_ID')
  const enterprisePriceId = Deno.env.get('STRIPE_ENTERPRISE_PRICE_ID')

  if (priceId === enterprisePriceId) return 'enterprise'
  if (priceId === proPriceId) return 'pro'
  return 'pro' // Default to pro for any paid plan
}
