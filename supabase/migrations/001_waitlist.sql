-- Waitlist table for Morphkit signups
CREATE TABLE waitlist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  source text DEFAULT 'landing',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS (required for Supabase client access)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (anon key can insert but not read/update/delete)
CREATE POLICY "Allow anonymous inserts" ON waitlist
  FOR INSERT WITH CHECK (true);
