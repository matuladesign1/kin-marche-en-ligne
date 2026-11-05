-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Agents de la Direction (accès par région),
-- messagerie ASSISTANT par ville/province, recommandations produits,
-- bannières vidéo, itinéraire des livreurs.
-- Aucune suppression destructive : les accès sont révoqués (revoked_at).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permissions des agents
-- ---------------------------------------------------------------------
create type public.staff_permission as enum ('stores', 'drivers', 'support', 'finance', 'users', 'marketing');

create table public.staff_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission public.staff_permission not null,
  province text,                      -- null = toutes les provinces
  city text,                          -- null = toutes les villes
  commune text,                       -- null = toutes les communes
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id)
);
create unique index staff_permissions_active_uq on public.staff_permissions
  (user_id, permission, lower(coalesce(province, '')), lower(coalesce(city, '')), lower(coalesce(commune, '')))
  where revoked_at is null;
create index staff_permissions_user_idx on public.staff_permissions (user_id) where revoked_at is null;
alter table public.staff_permissions enable row level security;
create policy "agents : lecture" on public.staff_permissions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());

create or replace function public.km_norm(p text)
returns text language sql immutable set search_path = '' as $$ select lower(trim(coalesce(p, ''))) $$;

create or replace function public.is_agent()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'agent' and p.is_active)
$$;

create or replace function public.has_permission(p_perm public.staff_permission)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.staff_permissions sp join public.profiles p on p.id = sp.user_id
    where sp.user_id = auth.uid() and sp.permission = p_perm and sp.revoked_at is null and p.role = 'agent' and p.is_active)
$$;

create or replace function public.has_national_permission(p_perm public.staff_permission)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.staff_permissions sp join public.profiles p on p.id = sp.user_id
    where sp.user_id = auth.uid() and sp.permission = p_perm and sp.revoked_at is null and p.role = 'agent' and p.is_active
      and sp.province is null and sp.city is null and sp.commune is null)
$$;

create or replace function public.has_permission_in(p_perm public.staff_permission, p_province text, p_city text, p_commune text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.staff_permissions sp join public.profiles p on p.id = sp.user_id
    where sp.user_id = auth.uid() and sp.permission = p_perm and sp.revoked_at is null and p.role = 'agent' and p.is_active
      and (sp.province is null or public.km_norm(sp.province) = public.km_norm(p_province))
      and (sp.city is null or public.km_norm(sp.city) = public.km_norm(p_city))
      and (sp.commune is null or public.km_norm(sp.commune) = public.km_norm(p_commune)))
$$;

create or replace function public.has_store_permission(p_perm public.staff_permission, p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.stores s where s.id = p_store_id and public.has_permission_in(p_perm, s.province, s.city, s.commune))
$$;

-- Un agent voit les magasins de sa région, quelle que soit sa mission.
create or replace function public.agent_sees_store(p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stores s
    join public.staff_permissions sp on sp.user_id = auth.uid() and sp.revoked_at is null
    join public.profiles p on p.id = sp.user_id and p.role = 'agent' and p.is_active
    where s.id = p_store_id
      and (sp.province is null or public.km_norm(sp.province) = public.km_norm(s.province))
      and (sp.city is null or public.km_norm(sp.city) = public.km_norm(s.city))
      and (sp.commune is null or public.km_norm(sp.commune) = public.km_norm(s.commune)))
$$;

create or replace function public.can_market(p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_store_id is null then public.has_national_permission('marketing')
              else public.has_store_permission('marketing', p_store_id) end
$$;

-- Livreurs : région (province, ville) + communes desservies
alter table public.drivers
  add column if not exists province text not null default 'Kinshasa',
  add column if not exists city text not null default 'Kinshasa';

create or replace function public.can_manage_driver(p_driver_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.drivers d
    join public.staff_permissions sp on sp.user_id = auth.uid() and sp.permission = 'drivers' and sp.revoked_at is null
    join public.profiles me on me.id = sp.user_id and me.role = 'agent' and me.is_active
    where d.id = p_driver_id
      and (sp.province is null or public.km_norm(sp.province) = public.km_norm(d.province))
      and (sp.city is null or public.km_norm(sp.city) = public.km_norm(d.city))
      and (sp.commune is null or exists (select 1 from unnest(d.zone_communes) z where public.km_norm(z) = public.km_norm(sp.commune))))
$$;

-- Utilisateurs : un agent « rôles » ne gère que des clients et livreurs de sa région.
create or replace function public.can_manage_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.profiles t
    join public.staff_permissions sp on sp.user_id = auth.uid() and sp.permission = 'users' and sp.revoked_at is null
    join public.profiles me on me.id = sp.user_id and me.role = 'agent' and me.is_active
    where t.id = p_user_id and t.role in ('customer', 'driver')
      and ((sp.province is null and sp.city is null and sp.commune is null)
        or exists (select 1 from public.addresses a where a.user_id = t.id
             and (sp.province is null or public.km_norm(sp.province) = public.km_norm(a.province))
             and (sp.city is null or public.km_norm(sp.city) = public.km_norm(a.city))
             and (sp.commune is null or public.km_norm(sp.commune) = public.km_norm(a.commune)))
        or exists (select 1 from public.drivers d where d.id = t.id
             and (sp.province is null or public.km_norm(sp.province) = public.km_norm(d.province))
             and (sp.city is null or public.km_norm(sp.city) = public.km_norm(d.city))
             and (sp.commune is null or exists (select 1 from unnest(d.zone_communes) z where public.km_norm(z) = public.km_norm(sp.commune))))))
$$;

-- ---------------------------------------------------------------------
-- 2. Garde-fous : les RPC vérifiées peuvent modifier rôle / statut livreur
-- ---------------------------------------------------------------------
create or replace function public.tg_protect_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_super_admin() and coalesce(current_setting('km.trusted', true), '') <> 'on' then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.id is distinct from old.id then
      raise exception 'Modification du rôle non autorisée' using errcode = '42501';
    end if;
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    perform public.write_audit('profile_role_change', 'profiles', new.id::text,
      jsonb_build_object('old_role', old.role, 'new_role', new.role, 'old_active', old.is_active, 'new_active', new.is_active));
  end if;
  return new;
end $$;

create or replace function public.tg_protect_driver()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_super_admin() and coalesce(current_setting('km.trusted', true), '') <> 'on' then
    if new.status is distinct from old.status or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by or new.rating is distinct from old.rating
       or new.rating_count is distinct from old.rating_count or new.driver_code is distinct from old.driver_code
       or new.province is distinct from old.province or new.city is distinct from old.city then
      raise exception 'Champ réservé à l''administration' using errcode = '42501';
    end if;
    if new.is_available and new.status <> 'verified' then
      raise exception 'Livreur non vérifié : impossible de se rendre disponible' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status then
    perform public.write_audit('driver_status_change', 'drivers', new.id::text,
      jsonb_build_object('old', old.status, 'new', new.status));
    if new.status <> 'verified' then new.is_available := false; end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Administration des agents (administrateur général uniquement)
-- ---------------------------------------------------------------------
create or replace function public.staff_grant(p_email text, p_permissions public.staff_permission[],
  p_province text default null, p_city text default null, p_commune text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
  v_perm public.staff_permission;
  v_n integer := 0;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(array_length(p_permissions, 1), 0) = 0 then raise exception 'PERMISSIONS_REQUIRED'; end if;
  select * into v_p from public.profiles where lower(email) = lower(trim(p_email));
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_p.id = auth.uid() then raise exception 'SELF_GRANT'; end if;
  if v_p.role not in ('customer', 'agent') then raise exception 'ROLE_CONFLICT' using hint = v_p.role::text; end if;
  update public.profiles set role = 'agent', is_active = true where id = v_p.id and (role <> 'agent' or not is_active);
  foreach v_perm in array p_permissions loop
    insert into public.staff_permissions (user_id, permission, province, city, commune, granted_by)
    values (v_p.id, v_perm, nullif(trim(p_province), ''), nullif(trim(p_city), ''), nullif(trim(p_commune), ''), auth.uid())
    on conflict do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  insert into public.notifications (user_id, kind, title, body)
  values (v_p.id, 'staff_access', 'Accès agent Kin Marché', 'De nouveaux accès vous ont été attribués dans l''espace d''administration web.');
  perform public.write_audit('staff_grant', 'profiles', v_p.id::text,
    jsonb_build_object('permissions', p_permissions, 'province', p_province, 'city', p_city, 'commune', p_commune));
  return v_n;
end $$;
revoke execute on function public.staff_grant(text, public.staff_permission[], text, text, text) from public, anon;

create or replace function public.staff_revoke(p_permission_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.staff_permissions set revoked_at = now(), revoked_by = auth.uid()
   where id = p_permission_id and revoked_at is null returning user_id into v_user;
  if v_user is null then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.staff_permissions where user_id = v_user and revoked_at is null) then
    update public.profiles set role = 'customer' where id = v_user and role = 'agent';
  end if;
  perform public.write_audit('staff_revoke', 'staff_permissions', p_permission_id::text, jsonb_build_object('user_id', v_user));
end $$;
revoke execute on function public.staff_revoke(uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 4. Opérations des agents (vérifiées côté serveur)
-- ---------------------------------------------------------------------
create or replace function public.staff_add_store_manager(p_store_id uuid, p_email text, p_title text default 'directeur')
returns void language plpgsql security definer set search_path = '' as $$
declare v_p public.profiles;
begin
  if not public.has_store_permission('stores', p_store_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title not in ('directeur', 'gestionnaire', 'assistant') then raise exception 'INVALID_TITLE'; end if;
  select * into v_p from public.profiles where lower(email) = lower(trim(p_email));
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_p.role not in ('customer', 'store_admin') then raise exception 'ROLE_CONFLICT' using hint = v_p.role::text; end if;
  perform set_config('km.trusted', 'on', true);
  update public.profiles set role = 'store_admin' where id = v_p.id and role = 'customer';
  perform set_config('km.trusted', 'off', true);
  insert into public.store_managers (store_id, user_id, title) values (p_store_id, v_p.id, p_title)
  on conflict (store_id, user_id) do update set title = excluded.title;
  insert into public.notifications (user_id, kind, title, body, data)
  select v_p.id, 'store_access', 'Accès supermarché', 'Vous gérez désormais : ' || s.name, jsonb_build_object('store_id', s.id)
  from public.stores s where s.id = p_store_id;
  perform public.write_audit('store_manager_add', 'stores', p_store_id::text, jsonb_build_object('user_id', v_p.id, 'title', p_title));
end $$;
revoke execute on function public.staff_add_store_manager(uuid, text, text) from public, anon;

-- Retrait d'un gestionnaire : s'il ne gère plus aucun magasin, il redevient client.
create or replace function public.tg_store_manager_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.store_managers where user_id = old.user_id) then
    perform set_config('km.trusted', 'on', true);
    update public.profiles set role = 'customer' where id = old.user_id and role = 'store_admin';
    perform set_config('km.trusted', 'off', true);
  end if;
  perform public.write_audit('store_manager_remove', 'stores', old.store_id::text, jsonb_build_object('user_id', old.user_id));
  return old;
end $$;
revoke execute on function public.tg_store_manager_removed() from public, anon, authenticated;
create trigger store_managers_removed after delete on public.store_managers
  for each row execute function public.tg_store_manager_removed();

create or replace function public.staff_make_driver(p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
  v_scope record;
begin
  if not public.has_permission('drivers') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_p from public.profiles where lower(email) = lower(trim(p_email));
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_p.role not in ('customer', 'driver') then raise exception 'ROLE_CONFLICT' using hint = v_p.role::text; end if;
  select sp.province, sp.city into v_scope from public.staff_permissions sp
   where sp.user_id = auth.uid() and sp.permission = 'drivers' and sp.revoked_at is null
   order by (sp.province is null), (sp.city is null) limit 1;
  perform set_config('km.trusted', 'on', true);
  update public.profiles set role = 'driver' where id = v_p.id and role = 'customer';
  perform set_config('km.trusted', 'off', true);
  insert into public.drivers (id, province, city)
  values (v_p.id, coalesce(v_scope.province, 'Kinshasa'), coalesce(v_scope.city, v_scope.province, 'Kinshasa'))
  on conflict (id) do nothing;
  insert into public.notifications (user_id, kind, title, body)
  values (v_p.id, 'driver_role', 'Espace livreur ouvert', 'Complétez votre dossier livreur dans l''application pour être certifié.');
  perform public.write_audit('driver_role_grant', 'profiles', v_p.id::text, null);
  return v_p.id;
end $$;
revoke execute on function public.staff_make_driver(text) from public, anon;

create or replace function public.review_driver(p_driver_id uuid, p_status public.driver_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_driver(p_driver_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status is null then raise exception 'STATUS_REQUIRED'; end if;
  perform set_config('km.trusted', 'on', true);
  update public.drivers set status = p_status,
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         verified_by = case when p_status = 'verified' then auth.uid() else verified_by end,
         is_available = case when p_status = 'verified' then is_available else false end
   where id = p_driver_id;
  if not found then raise exception 'DRIVER_NOT_FOUND'; end if;
  if p_status = 'verified' then
    update public.profiles set role = 'driver' where id = p_driver_id and role = 'customer';
    update public.driver_documents set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
     where driver_id = p_driver_id and status = 'pending';
  end if;
  perform set_config('km.trusted', 'off', true);
  insert into public.notifications (user_id, kind, title, body)
  values (p_driver_id, 'driver_review',
          case p_status when 'verified' then 'Compte livreur validé' when 'suspended' then 'Compte livreur suspendu'
                        when 'rejected' then 'Candidature livreur refusée' else 'Candidature en cours d''examen' end,
          p_note);
  perform public.write_audit('driver_review', 'drivers', p_driver_id::text, jsonb_build_object('status', p_status, 'note', p_note));
end $$;
revoke execute on function public.review_driver(uuid, public.driver_status, text) from public, anon;

-- Rôles : l'administrateur général gère tous les rôles (sauf « agent », géré par staff_grant) ;
-- un agent « rôles » ne peut que passer un client en livreur ou l'inverse, et (dés)activer, dans sa région.
create or replace function public.staff_set_user_role(p_user_id uuid, p_role public.app_role, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.profiles;
begin
  select * into v_old from public.profiles where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if p_role = 'agent' and v_old.role <> 'agent' then raise exception 'USE_AGENTS_PAGE'; end if;
  if public.is_super_admin() then
    if p_user_id = auth.uid() and (p_role <> 'super_admin' or not p_active) then raise exception 'SELF_LOCKOUT'; end if;
  else
    if not public.can_manage_user(p_user_id) or p_role not in ('customer', 'driver') then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  perform set_config('km.trusted', 'on', true);
  update public.profiles set role = p_role, is_active = p_active where id = p_user_id;
  perform set_config('km.trusted', 'off', true);
  if p_role = 'driver' then insert into public.drivers (id) values (p_user_id) on conflict (id) do nothing; end if;
  if v_old.role = 'agent' and p_role <> 'agent' then
    update public.staff_permissions set revoked_at = now(), revoked_by = auth.uid() where user_id = p_user_id and revoked_at is null;
  end if;
end $$;
revoke execute on function public.staff_set_user_role(uuid, public.app_role, boolean) from public, anon;

-- ---------------------------------------------------------------------
-- 5. Règles d'accès supplémentaires pour les agents (s'ajoutent aux existantes)
-- ---------------------------------------------------------------------
create policy "profils : agents" on public.profiles for select to authenticated
  using ((select public.is_agent()) and (
    public.can_manage_user(id) or public.can_manage_driver(id)
    or exists (select 1 from public.store_managers sm where sm.user_id = profiles.id and public.has_store_permission('stores', sm.store_id))
    or exists (select 1 from public.support_tickets t where t.customer_id = profiles.id and public.can_view_ticket(t.id))));

create policy "magasins : agents lecture" on public.stores for select to authenticated
  using ((select public.is_agent()) and public.agent_sees_store(id));
create policy "magasins : agents création" on public.stores for insert to authenticated
  with check ((select public.is_agent()) and public.has_permission_in('stores', province, city, commune));
create policy "magasins : agents mise à jour" on public.stores for update to authenticated
  using ((select public.is_agent()) and public.has_store_permission('stores', id))
  with check ((select public.is_agent()) and public.has_permission_in('stores', province, city, commune));
create policy "adresses magasins : agents" on public.store_addresses for all to authenticated
  using ((select public.is_agent()) and public.has_store_permission('stores', store_id))
  with check ((select public.is_agent()) and public.has_store_permission('stores', store_id));
create policy "gestionnaires : agents lecture" on public.store_managers for select to authenticated
  using ((select public.is_agent()) and public.has_store_permission('stores', store_id));
create policy "gestionnaires : agents retrait" on public.store_managers for delete to authenticated
  using ((select public.is_agent()) and public.has_store_permission('stores', store_id));

create policy "livreurs : agents" on public.drivers for select to authenticated
  using ((select public.is_agent()) and public.can_manage_driver(id));
create policy "documents livreur : agents" on public.driver_documents for select to authenticated
  using ((select public.is_agent()) and public.can_manage_driver(driver_id));
create policy "véhicules : agents" on public.driver_vehicles for select to authenticated
  using ((select public.is_agent()) and public.can_manage_driver(driver_id));
create policy "km documents livreur : agents" on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents' and (select public.is_agent())
         and exists (select 1 from public.drivers d where d.id::text = (storage.foldername(name))[1] and public.can_manage_driver(d.id)));

-- Commandes : lecture pour les agents finances / assistance de la région du magasin
create or replace function public.can_view_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin()
      or public.is_order_customer(p_order_id)
      or public.is_order_store_manager(p_order_id)
      or public.is_order_driver(p_order_id)
      or (public.is_agent() and exists (
            select 1 from public.orders o where o.id = p_order_id
              and (public.has_store_permission('finance', o.store_id) or public.has_store_permission('support', o.store_id))))
$$;

create policy "paiements : agents finances" on public.payments for select to authenticated
  using ((select public.is_agent()) and exists (select 1 from public.orders o where o.id = order_id and public.has_store_permission('finance', o.store_id)));
create policy "remboursements : agents finances" on public.refunds for select to authenticated
  using ((select public.is_agent()) and exists (select 1 from public.orders o where o.id = order_id and public.has_store_permission('finance', o.store_id)));
create policy "journal financier : agents" on public.financial_ledger for select to authenticated
  using ((select public.is_agent()) and (case when store_id is null then public.has_national_permission('finance')
                                              else public.has_store_permission('finance', store_id) end));
create policy "budgets : agents finances nationaux" on public.budgets for all to authenticated
  using ((select public.is_agent()) and public.has_national_permission('finance'))
  with check ((select public.is_agent()) and public.has_national_permission('finance'));
create policy "allocations : agents finances" on public.budget_allocations for select to authenticated
  using ((select public.is_agent()) and public.has_store_permission('finance', store_id));
create policy "allocations : agents finances nationaux" on public.budget_allocations for all to authenticated
  using ((select public.is_agent()) and public.has_national_permission('finance'))
  with check ((select public.is_agent()) and public.has_national_permission('finance'));
create policy "preuves paiement : agents finances" on public.payment_proofs for select to authenticated
  using ((select public.is_agent()) and exists (select 1 from public.orders o where o.id = order_id and public.has_store_permission('finance', o.store_id)));
create policy "km preuves paiement : agents finances" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (select public.is_agent())
         and exists (select 1 from public.orders o where o.id::text = (storage.foldername(name))[2]
                     and public.has_store_permission('finance', o.store_id)));

create or replace function public.review_payment_proof(p_proof_id uuid, p_approve boolean, p_amount numeric default null,
  p_currency public.currency_code default 'USD', p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.payment_proofs;
  v_o public.orders;
  v_pay uuid;
  v_res jsonb;
begin
  select * into v_p from public.payment_proofs where id = p_proof_id for update;
  if not found then raise exception 'PROOF_NOT_PENDING'; end if;
  select * into v_o from public.orders where id = v_p.order_id;
  if not public.has_store_permission('finance', v_o.store_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_p.status <> 'pending' then raise exception 'PROOF_NOT_PENDING'; end if;
  if p_approve then
    if p_amount is null or p_amount <= 0 then raise exception 'AMOUNT_REQUIRED'; end if;
    insert into public.payments (order_id, customer_id, method, provider, provider_reference, amount, currency, amount_usd, status)
    values (v_o.id, v_o.customer_id, v_p.method, 'verification_manuelle', coalesce(nullif(trim(p_reference), ''), 'PREUVE-' || v_p.id::text),
            p_amount, p_currency, v_o.total_usd, 'processing')
    returning id into v_pay;
    v_res := public.confirm_payment(v_pay, coalesce(nullif(trim(p_reference), ''), 'PREUVE-' || v_p.id::text), p_amount, p_currency,
                                    jsonb_build_object('proof_id', v_p.id, 'verified_by', auth.uid()));
    if coalesce((v_res->>'ok')::boolean, false) = false then
      raise exception 'PAYMENT_NOT_CONFIRMED' using detail = v_res::text;
    end if;
  end if;
  update public.payment_proofs set status = case when p_approve then 'approved'::public.moderation_status else 'rejected'::public.moderation_status end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note where id = p_proof_id;
  insert into public.notifications (user_id, kind, title, body, data)
  values (v_p.customer_id, 'payment_proof', case when p_approve then 'Preuve de paiement acceptée' else 'Preuve de paiement refusée' end,
          coalesce(p_note, 'Commande ' || v_o.order_number), jsonb_build_object('order_id', v_o.id));
  perform public.write_audit('payment_proof_review', 'payment_proofs', p_proof_id::text,
    jsonb_build_object('approve', p_approve, 'amount', p_amount, 'currency', p_currency, 'reference', p_reference));
  return coalesce(v_res, jsonb_build_object('ok', true));
end $$;
revoke execute on function public.review_payment_proof(uuid, boolean, numeric, public.currency_code, text, text) from public, anon;

create or replace function public.log_export(p_type text, p_filters jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_super_admin() or public.current_app_role() = 'store_admin' or public.has_permission('finance')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform public.write_audit('export', 'export', p_type, p_filters);
end $$;
revoke execute on function public.log_export(text, jsonb) from public, anon;

-- Marketing : coupons, promotions, bannières (par magasin de la région), partenaires (national)
create policy "coupons : agents marketing" on public.coupons for all to authenticated
  using ((select public.is_agent()) and public.can_market(store_id))
  with check ((select public.is_agent()) and public.can_market(store_id));
create policy "promotions : agents marketing" on public.promotions for all to authenticated
  using ((select public.is_agent()) and public.can_market(store_id))
  with check ((select public.is_agent()) and public.can_market(store_id));
create policy "bannières : agents marketing" on public.banners for all to authenticated
  using ((select public.is_agent()) and public.can_market(store_id))
  with check ((select public.is_agent()) and public.can_market(store_id));
create policy "partenaires : agents marketing" on public.partners for all to authenticated
  using ((select public.is_agent()) and public.has_national_permission('marketing'))
  with check ((select public.is_agent()) and public.has_national_permission('marketing'));
create policy "km branding : agents marketing" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (select public.is_agent()) and public.has_permission('marketing')
              and (name like 'banner-%' or name like 'partner-%'));

-- Bannières : photo ou vidéo (même format partout ; la photo sert d'affiche à la vidéo)
alter table public.banners
  add column if not exists media_type text not null default 'image' check (media_type in ('image', 'video')),
  add column if not exists video_url text;

-- ---------------------------------------------------------------------
-- 6. Messagerie : ASSISTANT par ville / province, assistants certifiés
-- ---------------------------------------------------------------------
alter table public.support_tickets
  add column if not exists province text,
  add column if not exists city text,
  add column if not exists commune text;
create index if not exists support_tickets_region_idx on public.support_tickets (lower(province), lower(city));

alter table public.messages
  add column if not exists sender_label text,
  add column if not exists sender_verified boolean not null default false;

create or replace function public.can_view_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_tickets t where t.id = p_ticket_id and (
      t.customer_id = auth.uid() or public.is_super_admin()
      or (t.channel = 'store' and t.store_id is not null and public.is_store_manager(t.store_id))
      or (t.channel = 'driver' and t.order_id is not null and public.is_order_driver(t.order_id))
      or (public.is_agent() and t.channel = 'general' and not t.is_internal
          and public.has_permission_in('support', t.province, t.city, t.commune))
      or (public.is_agent() and t.is_internal and t.store_id is not null and public.has_store_permission('support', t.store_id))))
$$;

create or replace function public.tg_ticket_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_internal and auth.uid() is not null
     and not (public.is_super_admin()
              or (new.store_id is not null and public.is_store_manager(new.store_id))
              or (new.store_id is not null and public.has_store_permission('support', new.store_id))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new.is_internal then new.channel := 'store'; end if;
  return new;
end $$;

-- Région du fil : celle du magasin, sinon celle choisie par le client, sinon son adresse.
create or replace function public.tg_ticket_region()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_s public.stores;
  v_a public.addresses;
begin
  new.province := nullif(trim(new.province), '');
  new.city := nullif(trim(new.city), '');
  new.commune := nullif(trim(new.commune), '');
  if new.store_id is not null then
    select * into v_s from public.stores where id = new.store_id;
    new.province := coalesce(v_s.province, new.province);
    new.city := coalesce(v_s.city, new.city);
    new.commune := coalesce(v_s.commune, new.commune);
  end if;
  if new.province is null and new.city is null then
    select a.* into v_a from public.addresses a
      left join public.customer_profiles cp on cp.user_id = a.user_id
     where a.user_id = new.customer_id
     order by (a.id = cp.default_address_id) desc nulls last, a.is_default desc, a.created_at desc limit 1;
    new.province := v_a.province;
    new.city := v_a.city;
    new.commune := coalesce(new.commune, v_a.commune);
  end if;
  new.province := coalesce(new.province, 'Kinshasa');
  new.city := coalesce(new.city, new.province);
  return new;
end $$;
revoke execute on function public.tg_ticket_region() from public, anon, authenticated;
create trigger support_tickets_region before insert on public.support_tickets
  for each row execute function public.tg_ticket_region();

-- Nom affiché des assistants : jamais celui de la personne, toujours « ASSISTANT … » certifié.
create or replace function public.tg_message_label()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_t public.support_tickets;
  v_staff boolean;
begin
  select * into v_t from public.support_tickets where id = new.ticket_id;
  new.sender_label := null;
  new.sender_verified := false;
  if v_t.is_internal then
    select exists (select 1 from public.profiles p where p.id = new.sender_id and p.role in ('super_admin', 'agent')) into v_staff;
    if v_staff then
      new.sender_label := 'DIRECTION Kin Marché';
    else
      select 'SUPERMARCHÉ ' || s.name into new.sender_label from public.stores s where s.id = v_t.store_id;
    end if;
    new.sender_verified := true;
  elsif new.sender_id is distinct from v_t.customer_id then
    if v_t.channel = 'store' then
      select 'ASSISTANT ' || s.name into new.sender_label from public.stores s where s.id = v_t.store_id;
    elsif v_t.channel = 'driver' then
      new.sender_label := 'LIVREUR Kin Marché';
    end if;
    new.sender_label := coalesce(new.sender_label, 'ASSISTANT ' || coalesce(v_t.city, v_t.province, 'Kin Marché'));
    new.sender_verified := true;
  end if;
  return new;
end $$;
revoke execute on function public.tg_message_label() from public, anon, authenticated;
create trigger messages_label before insert on public.messages
  for each row execute function public.tg_message_label();

create or replace function public.tg_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_t public.support_tickets;
begin
  select * into v_t from public.support_tickets where id = new.ticket_id;
  update public.support_tickets set updated_at = now(),
         status = case when status in ('resolved', 'closed') then 'open'::public.ticket_status else status end where id = v_t.id;
  -- Client : le message porte le nom de l'assistant certifié.
  if new.sender_id is distinct from v_t.customer_id and not v_t.is_internal then
    insert into public.notifications (user_id, kind, title, body, data)
    values (v_t.customer_id, 'message', coalesce(new.sender_label, 'ASSISTANT Kin Marché'), left(new.body, 120),
            jsonb_build_object('ticket_id', v_t.id));
  end if;
  -- Équipe : directeurs du magasin, Direction, agents assistants de la région, livreur.
  insert into public.notifications (user_id, kind, title, body, data)
  select distinct u, 'message', 'Nouveau message : ' || v_t.subject, left(new.body, 120), jsonb_build_object('ticket_id', v_t.id)
  from (
    select case when v_t.is_internal then v_t.customer_id end as u
    union select sm.user_id from public.store_managers sm where v_t.store_id is not null and sm.store_id = v_t.store_id and v_t.channel = 'store'
    union select p.id from public.profiles p where p.role = 'super_admin' and p.is_active and (v_t.channel = 'general' or v_t.is_internal)
    union select sp.user_id from public.staff_permissions sp join public.profiles p on p.id = sp.user_id and p.role = 'agent' and p.is_active
          where sp.permission = 'support' and sp.revoked_at is null
            and ((v_t.channel = 'general' and not v_t.is_internal
                  and (sp.province is null or public.km_norm(sp.province) = public.km_norm(v_t.province))
                  and (sp.city is null or public.km_norm(sp.city) = public.km_norm(v_t.city))
                  and (sp.commune is null or public.km_norm(sp.commune) = public.km_norm(v_t.commune)))
              or (v_t.is_internal and exists (select 1 from public.stores s where s.id = v_t.store_id
                  and (sp.province is null or public.km_norm(sp.province) = public.km_norm(s.province))
                  and (sp.city is null or public.km_norm(sp.city) = public.km_norm(s.city))
                  and (sp.commune is null or public.km_norm(sp.commune) = public.km_norm(s.commune)))))
    union select a.driver_id from public.delivery_assignments a where v_t.channel = 'driver' and a.order_id = v_t.order_id and a.status = 'accepted'
  ) x where u is not null and u is distinct from new.sender_id
        and (v_t.is_internal or u is distinct from v_t.customer_id);
  return new;
end $$;
revoke execute on function public.tg_message_notify() from public, anon, authenticated;

-- Villes / provinces où un ASSISTANT Kin Marché répond (d'après les magasins actifs).
create or replace function public.assistant_regions()
returns table (province text, city text, stores integer)
language sql stable security definer set search_path = '' as $$
  with r as (
    select coalesce(nullif(trim(s.province), ''), 'Kinshasa') as province,
           coalesce(nullif(trim(s.city), ''), nullif(trim(s.province), ''), 'Kinshasa') as city,
           count(*)::integer as stores
    from public.stores s where s.is_active group by 1, 2
  )
  select * from r
  union all
  select 'Kinshasa', 'Kinshasa', 0 where not exists (select 1 from r where lower(r.city) = 'kinshasa')
  order by 3 desc, 2
$$;
revoke execute on function public.assistant_regions() from public, anon;
grant execute on function public.assistant_regions() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Recommandations de produits par les clients
-- ---------------------------------------------------------------------
alter table public.products add column if not exists recommend_count integer not null default 0;

create table public.product_recommendations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index product_recommendations_product_idx on public.product_recommendations (product_id);
alter table public.product_recommendations enable row level security;
create policy "recommandations : soi-même lecture" on public.product_recommendations for select to authenticated
  using (user_id = (select auth.uid()));
create policy "recommandations : ajout" on public.product_recommendations for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "recommandations : retrait" on public.product_recommendations for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.tg_product_recommend_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_product uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products set recommend_count = (select count(*) from public.product_recommendations r where r.product_id = v_product)
   where id = v_product;
  return null;
end $$;
revoke execute on function public.tg_product_recommend_count() from public, anon, authenticated;
create trigger product_recommendations_count after insert or delete on public.product_recommendations
  for each row execute function public.tg_product_recommend_count();

-- ---------------------------------------------------------------------
-- 8. Itinéraire réel du livreur (Google Routes, calculé côté serveur)
-- ---------------------------------------------------------------------
alter table public.delivery_assignments add column if not exists route_polyline text;

create or replace function public.get_order_tracking(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_store public.stores;
  v_a public.delivery_assignments;
  v_driver jsonb;
  v_pos jsonb;
begin
  if not public.can_view_order(p_order_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order_id;
  select * into v_store from public.stores where id = v_order.store_id;
  select * into v_a from public.delivery_assignments
   where order_id = p_order_id and status in ('accepted', 'completed') order by offered_at desc limit 1;

  if v_a.id is not null then
    select jsonb_build_object(
      'name', pr.full_name, 'avatar_url', pr.avatar_url, 'driver_code', d.driver_code,
      'phone', case when v_order.status in ('driver_assigned','driver_to_store','picked_up','in_delivery','driver_near','driver_arrived','recipient_check')
                    then pr.phone end,
      'transport', (select v.mode from public.driver_vehicles v where v.driver_id = d.id order by v.is_primary desc limit 1),
      'rating', d.rating, 'location_shared', d.location_shared)
    into v_driver
    from public.drivers d join public.profiles pr on pr.id = d.id where d.id = v_a.driver_id;

    if v_a.status = 'accepted' then
      select jsonb_build_object('latitude', t.latitude, 'longitude', t.longitude, 'recorded_at', t.recorded_at,
        'straight_line_km_to_customer', round(public.distance_km(t.latitude, t.longitude,
            (v_order.delivery_address->>'latitude')::double precision,
            (v_order.delivery_address->>'longitude')::double precision)::numeric, 2))
      into v_pos
      from public.delivery_tracking t
      join public.drivers d on d.id = v_a.driver_id and d.location_shared
      where t.assignment_id = v_a.id order by t.recorded_at desc limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number, 'status', v_order.status,
    'payment_status', v_order.payment_status,
    'store', jsonb_build_object('name', v_store.name, 'phone', v_store.phone,
                                'latitude', v_store.latitude, 'longitude', v_store.longitude),
    'assignment', case when v_a.id is null then null else jsonb_build_object(
        'id', v_a.id, 'status', v_a.status, 'accepted_at', v_a.responded_at, 'picked_up_at', v_a.picked_up_at,
        'delivered_at', v_a.delivered_at, 'eta_minutes', v_a.eta_minutes,
        'route_distance_km', v_a.route_distance_km, 'eta_updated_at', v_a.eta_updated_at, 'eta_target', v_a.eta_target,
        'route_polyline', case when v_a.status = 'accepted' then v_a.route_polyline end) end,
    'driver', v_driver,
    'position', v_pos,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('status', h.status, 'at', h.created_at, 'note', h.note) order by h.created_at), '[]'::jsonb)
                from public.order_status_history h where h.order_id = p_order_id));
end $$;
revoke execute on function public.get_order_tracking(uuid) from public, anon;

-- Droits d'exécution : fonctions d'accès utilisables par les politiques, jamais par anon.
revoke execute on function public.is_agent() from public, anon;
revoke execute on function public.has_permission(public.staff_permission) from public, anon;
revoke execute on function public.has_national_permission(public.staff_permission) from public, anon;
revoke execute on function public.has_permission_in(public.staff_permission, text, text, text) from public, anon;
revoke execute on function public.has_store_permission(public.staff_permission, uuid) from public, anon;
revoke execute on function public.agent_sees_store(uuid) from public, anon;
revoke execute on function public.can_market(uuid) from public, anon;
revoke execute on function public.can_manage_driver(uuid) from public, anon;
revoke execute on function public.can_manage_user(uuid) from public, anon;
grant execute on function public.is_agent(), public.has_permission(public.staff_permission),
  public.has_national_permission(public.staff_permission), public.has_permission_in(public.staff_permission, text, text, text),
  public.has_store_permission(public.staff_permission, uuid), public.agent_sees_store(uuid), public.can_market(uuid),
  public.can_manage_driver(uuid), public.can_manage_user(uuid) to authenticated;
