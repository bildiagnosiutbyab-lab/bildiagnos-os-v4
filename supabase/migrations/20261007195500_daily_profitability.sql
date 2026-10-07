-- Internal daily profitability. Amounts are ex VAT and unverified part costs are excluded from contribution.
create or replace function public.daily_profitability(p_day date default current_date)
returns table(workshop_id uuid,labor_sales numeric,parts_sales numeric,verified_parts_cost numeric,verified_parts_sales numeric,unverified_parts_sales numeric,verified_part_lines bigint,unverified_part_lines bigint,contribution numeric)
language sql security invoker set search_path=public as $$
with day_orders as (
 select wo.id,wo.workshop_id from public.work_orders wo
 where public.is_workshop_member(wo.workshop_id)
 and (wo.opened_at at time zone 'Europe/Stockholm')::date=p_day
 and coalesce(wo.status_code,'')<>'cancelled'
),svc as (
 select d.workshop_id,coalesce(sum(coalesce(s.quantity,1)*coalesce(s.unit_price,0)),0) labor_sales
 from day_orders d left join public.work_order_services s on s.work_order_id=d.id and coalesce(s.status,'') not in ('rejected','removed') group by d.workshop_id
),prt as (
 select d.workshop_id,
 coalesce(sum(coalesce(p.quantity,1)*coalesce(p.sale_price,0)),0) parts_sales,
 coalesce(sum(case when p.actual_cost is not null then coalesce(p.quantity,1)*p.actual_cost else 0 end),0) verified_parts_cost,
 coalesce(sum(case when p.actual_cost is not null then coalesce(p.quantity,1)*coalesce(p.sale_price,0) else 0 end),0) verified_parts_sales,
 coalesce(sum(case when p.actual_cost is null then coalesce(p.quantity,1)*coalesce(p.sale_price,0) else 0 end),0) unverified_parts_sales,
 count(*) filter(where p.actual_cost is not null) verified_part_lines,
 count(*) filter(where p.actual_cost is null) unverified_part_lines
 from day_orders d left join public.work_order_parts p on p.work_order_id=d.id and coalesce(p.status,'') not in ('rejected','removed') group by d.workshop_id
)
select coalesce(s.workshop_id,p.workshop_id),coalesce(s.labor_sales,0),coalesce(p.parts_sales,0),coalesce(p.verified_parts_cost,0),coalesce(p.verified_parts_sales,0),coalesce(p.unverified_parts_sales,0),coalesce(p.verified_part_lines,0),coalesce(p.unverified_part_lines,0),coalesce(s.labor_sales,0)+coalesce(p.verified_parts_sales,0)-coalesce(p.verified_parts_cost,0)
from svc s full join prt p using(workshop_id);
$$;
revoke all on function public.daily_profitability(date) from public,anon;
grant execute on function public.daily_profitability(date) to authenticated;
