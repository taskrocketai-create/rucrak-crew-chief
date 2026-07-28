-- Run this once in Supabase's SQL Editor (in your existing TaskRocket
-- Supabase project — no need for a separate project) to create the table
-- Crew Chief logs to.
--
-- This is intentionally minimal: it's a record of "a question got handled,"
-- not a full conversation transcript store. See README.md for why.

create table if not exists rucrak_chief_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_message text,      -- the customer's opening question in this exchange
  last_message text,       -- their most recent message (may be same as first_message)
  message_count integer,   -- how many user messages were in this exchange
  had_image boolean default false  -- whether a fitment photo was attached
);

-- Optional: an index if you'll be querying by date range often (e.g. "calls this month")
create index if not exists rucrak_chief_calls_created_at_idx on rucrak_chief_calls (created_at desc);

-- Row Level Security: locked down by default, since this table is only
-- written to via the service role key from your Vercel function, and only
-- read by you directly in the Supabase table editor or SQL editor.
alter table rucrak_chief_calls enable row level security;
-- No policies added on purpose — with RLS on and no policies, only the
-- service role key (which bypasses RLS) can read/write. That's exactly
-- what api/chat.js uses, and it's what you'll use when you look at the
-- table in the Supabase dashboard (dashboard access uses elevated
-- permissions, separate from RLS policies).

-- ---------------------------------------------------------------------------
-- Escalation pipeline (added later): when Crew Chief genuinely can't answer
-- something — in text (api/chat.js) or voice (api/log-escalation.js, called
-- directly by Vapi as a tool) — it logs here AND (if RESEND_API_KEY and
-- JASON_NOTIFY_EMAIL are set) fires an email so Jason doesn't have to comb
-- through every conversation to find the ones that actually needed him.

create table if not exists rucrak_chief_escalations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  channel text,                -- 'text' or 'voice'
  question text,                -- what Crew Chief couldn't resolve
  customer_name text,           -- null if not given
  customer_contact text,        -- null if not given (phone or email, whatever they gave)
  resolved boolean default false -- flip to true once Jason's dealt with it, so
                                  -- you can filter down to what's still outstanding
);

create index if not exists rucrak_chief_escalations_created_at_idx on rucrak_chief_escalations (created_at desc);
create index if not exists rucrak_chief_escalations_resolved_idx on rucrak_chief_escalations (resolved) where resolved = false;

alter table rucrak_chief_escalations enable row level security;
-- Same RLS approach as rucrak_chief_calls above — locked down, service role
-- key (used by both api/chat.js and api/log-escalation.js) bypasses it.

-- ---------------------------------------------------------------------------
-- Marketing context (added later): light, aggregate-only info Crew Chief
-- picks up naturally (or asks 1-2 casual questions about) — vehicle type,
-- general region, how they found rucRak, what they use it for. No email
-- notification for this one, it's just data for Jason to review in
-- aggregate later, not anything urgent. Multiple rows can exist per
-- conversation as different details come up — this isn't meant to be
-- joined back to a single customer record, just aggregated (e.g. "most
-- common vehicle," "top referral sources this month").

create table if not exists rucrak_marketing_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  channel text,             -- 'text' or 'voice'
  vehicle text,             -- e.g. "Jeep Wrangler JL", null if not captured
  region text,               -- general area/state, never a precise address
  referral_source text,      -- how they found rucRak, null if not captured
  use_case text              -- daily driver / off-roading / overlanding / etc, null if not captured
);

create index if not exists rucrak_marketing_notes_created_at_idx on rucrak_marketing_notes (created_at desc);

alter table rucrak_marketing_notes enable row level security;
-- Same RLS approach as the other two tables above.

