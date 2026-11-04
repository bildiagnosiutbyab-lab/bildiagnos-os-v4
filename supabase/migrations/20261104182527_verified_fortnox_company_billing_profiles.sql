-- Server-only billing profiles verified against an official Fortnox document.
-- Individual workshop billing values are provisioned privately, never in source.
create table public.fortnox_company_billing_profiles (
  workshop_id uuid primary key references public.workshops(id),
  organisation_number text not null,
  company_name text not null,
  billing_data jsonb not null,
  source_invoice_number text not null,
  source_note text not null,
  verified_at timestamptz not null default now()
);
alter table public.fortnox_company_billing_profiles enable row level security;
revoke all on public.fortnox_company_billing_profiles from anon, authenticated;
grant select on public.fortnox_company_billing_profiles to service_role;
