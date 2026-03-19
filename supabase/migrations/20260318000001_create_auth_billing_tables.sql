-- Migration: Create auth, billing, and usage tracking tables for Morphkit monetization
-- Date: 2026-03-18

-- =============================================================================
-- 1. USERS — extends Supabase Auth
-- =============================================================================
CREATE TABLE users (
    id          uuid PRIMARY KEY REFERENCES auth.users(id),
    email       text NOT NULL,
    name        text,
    created_at  timestamptz DEFAULT now()
);

-- =============================================================================
-- 2. API_KEYS — hashed keys with prefix for identification
-- =============================================================================
CREATE TABLE api_keys (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash    text NOT NULL,
    key_prefix  text NOT NULL,
    name        text DEFAULT 'Default',
    created_at  timestamptz DEFAULT now(),
    last_used_at timestamptz,
    revoked_at  timestamptz
);

-- =============================================================================
-- 3. SUBSCRIPTIONS — Stripe-backed subscription state
-- =============================================================================
CREATE TABLE subscriptions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id      text,
    stripe_subscription_id  text UNIQUE,
    tier                    text NOT NULL DEFAULT 'free'
                            CHECK (tier IN ('free', 'pro', 'enterprise')),
    status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
    current_period_start    timestamptz,
    current_period_end      timestamptz,
    created_at              timestamptz DEFAULT now(),
    updated_at              timestamptz DEFAULT now()
);

-- =============================================================================
-- 4. USAGE_LOGS — per-conversion telemetry
-- =============================================================================
CREATE TABLE usage_logs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timestamp           timestamptz DEFAULT now(),
    source_repo         text,
    status              text NOT NULL
                        CHECK (status IN ('success', 'failed', 'quota_exceeded')),
    tokens_used         integer DEFAULT 0,
    generation_time_ms  integer
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_api_keys_user_id    ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);

CREATE INDEX idx_subscriptions_user_id              ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id   ON subscriptions(stripe_customer_id);

CREATE INDEX idx_usage_logs_user_id   ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_timestamp ON usage_logs(timestamp);
CREATE INDEX idx_usage_logs_status    ON usage_logs(status);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- users -----------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_update_own ON users
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- api_keys --------------------------------------------------------------------
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_insert_own ON api_keys
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY api_keys_select_own ON api_keys
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY api_keys_update_own ON api_keys
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- subscriptions ---------------------------------------------------------------
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select_own ON subscriptions
    FOR SELECT USING (auth.uid() = user_id);

-- usage_logs ------------------------------------------------------------------
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_logs_insert_own ON usage_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY usage_logs_select_own ON usage_logs
    FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- AUTO-PROVISION: trigger to create user + free subscription on auth signup
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Create the public user record
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email);

    -- Provision a free-tier subscription
    INSERT INTO public.subscriptions (user_id, tier, status)
    VALUES (NEW.id, 'free', 'active');

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
