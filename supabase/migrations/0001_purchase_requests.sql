-- purchase_requests: one row per guardian-approval request.
-- RLS is enabled with NO anon/authenticated policies, so the table is reachable
-- only via the service role inside Edge Functions. The shopper's device never
-- touches this table directly.
create table if not exists public.purchase_requests (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','expired')),
  total         numeric,
  items         jsonb not null default '[]'::jsonb,
  guardian_email text not null,
  guardian_name  text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  expires_at    timestamptz not null default (now() + interval '1 day'),
  token_used    boolean not null default false
);

create index if not exists purchase_requests_token_idx on public.purchase_requests (token);
-- Supports the create-request rate guard (counts by recipient/time and by time).
create index if not exists purchase_requests_email_created_idx on public.purchase_requests (guardian_email, created_at);
create index if not exists purchase_requests_created_idx on public.purchase_requests (created_at);

alter table public.purchase_requests enable row level security;
-- Intentionally no policies: only the service role (Edge Functions) may read/write.
