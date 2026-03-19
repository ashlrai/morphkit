# Morphkit Supabase Backend

## Setup

### Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Stripe account](https://stripe.com) (for billing)

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and anon key

### 2. Run Migrations
```bash
supabase db push
```

This creates the `users`, `api_keys`, `subscriptions`, and `usage_logs` tables with RLS policies.

### 3. Deploy Edge Functions
```bash
supabase functions deploy validate-key
supabase functions deploy log-usage
supabase functions deploy stripe-webhook
supabase functions deploy regenerate-key
supabase functions deploy cancel-subscription
```

### 4. Set Function Secrets
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_PRO_PRICE_ID=price_...
supabase secrets set STRIPE_ENTERPRISE_PRICE_ID=price_...
```

### 5. Configure Stripe Webhook
1. In Stripe Dashboard → Webhooks, add endpoint:
   `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`
2. Subscribe to events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

### 6. Enable Auth
1. In Supabase Dashboard → Authentication → Providers
2. Enable "Email" with magic link enabled
3. Set redirect URL to `https://morphkit.dev/dashboard`

### 7. Update Site Config
Update the Supabase URL and anon key in:
- `site/index.html` (line ~2110)
- `site/dashboard.html` (line ~152)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Auto-set in Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-set in Edge Functions |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRO_PRICE_ID` | Stripe price ID for Pro plan |
| `STRIPE_ENTERPRISE_PRICE_ID` | Stripe price ID for Enterprise plan |

## Schema

See `migrations/20260318000001_create_auth_billing_tables.sql` for the full schema including RLS policies.

## Self-Hosted

For self-hosted deployments:
1. Set `MORPHKIT_API_URL` in the CLI to point to your Supabase project
2. Update site config to use your Supabase project credentials
3. Set up your own Stripe account for billing
