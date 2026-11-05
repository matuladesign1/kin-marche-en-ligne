-- Comptes créés avant l'installation de Kin Marché (projet partagé) :
-- le profil client est créé à la première connexion dans l'application.
create or replace function public.ensure_profile()
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_user auth.users;
  v_profile public.profiles;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if found then return v_profile; end if;
  select * into v_user from auth.users where id = v_uid;
  insert into public.profiles (id, role, full_name, phone, email)
  values (v_uid, 'customer', nullif(v_user.raw_user_meta_data->>'full_name', ''), v_user.phone, v_user.email)
  returning * into v_profile;
  insert into public.customer_profiles (user_id) values (v_uid) on conflict do nothing;
  insert into public.loyalty_accounts (user_id) values (v_uid) on conflict do nothing;
  insert into public.carts (user_id) values (v_uid) on conflict do nothing;
  return v_profile;
end $$;
revoke execute on function public.ensure_profile() from public, anon;
