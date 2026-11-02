-- Trace de chaque export (données personnelles et financières) dans le journal d'audit.
create or replace function public.log_export(p_type text, p_filters jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_super_admin() or public.current_app_role() = 'store_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform public.write_audit('export', 'export', p_type, p_filters);
end $$;
revoke execute on function public.log_export(text, jsonb) from public, anon;
