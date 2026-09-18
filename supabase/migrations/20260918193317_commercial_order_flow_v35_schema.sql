-- Additive fields for the v35 commercial flow.
-- quote_number and invoice_number are already generated identity columns.
alter table public.quotes
  add column if not exists rejected_at timestamptz,
  add column if not exists notes text,
  add column if not exists variable_price boolean not null default false,
  add column if not exists warranty_enabled boolean not null default false,
  add column if not exists warranty_months integer,
  add column if not exists warranty_km integer,
  add column if not exists document_language text not null default 'sv';

alter table public.payments alter column invoice_id drop not null;

create sequence if not exists public.receipt_number_sequence;

create or replace function public.assign_payment_receipt_reference()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.receipt_reference, '')), '') is null then
    new.receipt_reference := format(
      'REC-%s-%s',
      to_char(coalesce(new.accepted_at, now()), 'YYYY'),
      lpad(nextval('public.receipt_number_sequence')::text, 6, '0')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists set_payment_receipt_reference on public.payments;
create trigger set_payment_receipt_reference
before insert on public.payments
for each row execute function public.assign_payment_receipt_reference();
