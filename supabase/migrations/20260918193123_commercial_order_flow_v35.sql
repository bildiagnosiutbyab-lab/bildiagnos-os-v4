-- Additive v35 commercial-flow foundation. No existing data is modified.
alter table public.quotes add column if not exists prepared_at timestamptz;
