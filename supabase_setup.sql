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
