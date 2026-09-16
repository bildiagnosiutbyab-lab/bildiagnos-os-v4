drop policy if exists member_read_workshops on public.workshops;
create policy member_read_workshops on public.workshops for select to authenticated
using (public.is_workshop_member(id));

drop policy if exists self_read_profile on public.profiles;
create policy self_read_profile on public.profiles for select to authenticated using (id=auth.uid());
drop policy if exists self_update_profile on public.profiles;
create policy self_update_profile on public.profiles for update to authenticated
using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists member_read_memberships on public.workshop_members;
create policy member_read_memberships on public.workshop_members for select to authenticated
using (user_id=auth.uid());

revoke all on function public.audit_row_change() from public, anon, authenticated;
revoke all on function public.is_workshop_member(uuid) from public, anon;
grant execute on function public.is_workshop_member(uuid) to authenticated;
