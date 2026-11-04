create table public.invoice_email_deliveries (
 id uuid primary key default gen_random_uuid(),
 workshop_id uuid not null references public.workshops(id),
 work_order_id uuid not null unique references public.work_orders(id),
 job_id uuid not null references public.fortnox_invoice_jobs(id),
 document_number text not null,recipient text not null,pdf_sha256 text not null,
 status text not null check(status in ('sending','sent','uncertain')),
 channel text not null,message_id text,created_at timestamptz not null default now(),
 sent_at timestamptz,error_message text
);
alter table public.invoice_email_deliveries enable row level security;
revoke all on public.invoice_email_deliveries from anon,authenticated;
grant select,insert,update on public.invoice_email_deliveries to service_role;
