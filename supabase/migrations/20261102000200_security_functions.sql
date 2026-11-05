-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Rôles, fonctions de sécurité et triggers
-- =====================================================================

alter table public.coupons add column is_public boolean not null default false;
alter table public.products add column weight_kg numeric(10,3) check (weight_kg >= 0);

-- ---------------------------------------------------------------------
-- Fonctions d'identité (SECURITY DEFINER pour éviter la récursion RLS)
-- ---------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin' and p.is_active)
$$;

create or replace function public.is_store_manager(p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.store_managers sm
    join public.profiles p on p.id = sm.user_id
    where sm.store_id = p_store_id and sm.user_id = auth.uid()
      and p.role = 'store_admin' and p.is_active)
$$;

create or replace function public.managed_store_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select sm.store_id from public.store_managers sm
  join public.profiles p on p.id = sm.user_id
  where sm.user_id = auth.uid() and p.role = 'store_admin' and p.is_active
$$;

create or replace function public.is_order_customer(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = p_order_id and o.customer_id = auth.uid())
$$;

create or replace function public.is_order_store_manager(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = p_order_id and public.is_store_manager(o.store_id))
$$;

create or replace function public.is_order_driver(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.delivery_assignments a
    where a.order_id = p_order_id and a.driver_id = auth.uid()
      and a.status in ('accepted','completed'))
$$;

create or replace function public.can_view_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin()
      or public.is_order_customer(p_order_id)
      or public.is_order_store_manager(p_order_id)
      or public.is_order_driver(p_order_id)
$$;

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_details)
$$;

-- Distance (km) entre deux points GPS — formule de Haversine
create or replace function public.distance_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null else
    6371 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
  end
$$;

-- ---------------------------------------------------------------------
-- Création automatique du profil à l'inscription (toujours « customer »)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_lang text := new.raw_user_meta_data->>'language';
begin
  insert into public.profiles (id, role, full_name, phone, email, language)
  values (
    new.id,
    'customer',
    nullif(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.phone, nullif(new.raw_user_meta_data->>'phone', '')),
    new.email,
    case when v_lang in ('fr','en','ln','sw') then v_lang::public.app_language else 'fr' end
  );
  insert into public.customer_profiles (user_id) values (new.id);
  insert into public.loyalty_accounts (user_id) values (new.id);
  insert into public.carts (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un utilisateur ne peut jamais changer son propre rôle ni se réactiver.
create or replace function public.tg_protect_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
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
create trigger profiles_protect before update on public.profiles
  for each row execute function public.tg_protect_profile();

-- Un livreur ne peut pas se certifier lui-même.
create or replace function public.tg_protect_driver()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if new.status is distinct from old.status or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by or new.rating is distinct from old.rating
       or new.rating_count is distinct from old.rating_count or new.driver_code is distinct from old.driver_code then
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
create trigger drivers_protect before update on public.drivers
  for each row execute function public.tg_protect_driver();

-- Historique des taux de change
create or replace function public.tg_rate_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  insert into public.exchange_rate_history (currency, rate_per_usd, recorded_by)
  values (new.currency, new.rate_per_usd, auth.uid());
  return new;
end $$;
create trigger exchange_rates_history before insert or update on public.exchange_rates
  for each row execute function public.tg_rate_history();

-- Historique des statuts de commande + notification client
create or replace function public.tg_order_status_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history (order_id, status, actor_id)
    values (new.id, new.status, auth.uid());

    v_title := case new.status
      when 'received' then 'Commande reçue'
      when 'payment_confirmed' then 'Paiement confirmé'
      when 'sent_to_store' then 'Commande transmise au supermarché'
      when 'preparing' then 'Préparation en cours'
      when 'ready' then 'Commande prête'
      when 'driver_assigned' then 'Livreur assigné'
      when 'picked_up' then 'Colis récupérés'
      when 'in_delivery' then 'Livraison en cours'
      when 'driver_near' then 'Votre livreur est proche'
      when 'driver_arrived' then 'Votre livreur est arrivé'
      when 'delivered' then 'Livraison confirmée'
      when 'completed' then 'Commande terminée'
      when 'cancelled' then 'Commande annulée'
      when 'failed' then 'Livraison échouée'
      when 'refunded' then 'Commande remboursée'
      else null end;

    if v_title is not null then
      insert into public.notifications (user_id, kind, title, body, data)
      values (new.customer_id, 'order_status', v_title, 'Commande ' || new.order_number,
              jsonb_build_object('order_id', new.id, 'status', new.status));
    end if;
  end if;
  return new;
end $$;
create trigger orders_status_log after insert or update of status on public.orders
  for each row execute function public.tg_order_status_log();

-- Mise à jour des notes (produit / magasin / livreur) à l'approbation d'un avis
create or replace function public.tg_review_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.target_type = 'product' and new.product_id is not null then
    update public.products p set
      rating = coalesce((select avg(rating) from public.reviews r where r.product_id = p.id and r.target_type = 'product' and r.status = 'approved'), 0),
      rating_count = (select count(*) from public.reviews r where r.product_id = p.id and r.target_type = 'product' and r.status = 'approved')
    where p.id = new.product_id;
  elsif new.target_type = 'store' and new.store_id is not null then
    update public.stores s set
      rating = coalesce((select avg(rating) from public.reviews r where r.store_id = s.id and r.target_type = 'store' and r.status = 'approved'), 0),
      rating_count = (select count(*) from public.reviews r where r.store_id = s.id and r.target_type = 'store' and r.status = 'approved')
    where s.id = new.store_id;
  elsif new.target_type in ('driver','delivery') and new.driver_id is not null then
    update public.drivers d set
      rating = coalesce((select avg(rating) from public.reviews r where r.driver_id = d.id and r.target_type in ('driver','delivery') and r.status = 'approved'), 0),
      rating_count = (select count(*) from public.reviews r where r.driver_id = d.id and r.target_type in ('driver','delivery') and r.status = 'approved')
    where d.id = new.driver_id;
  end if;
  return new;
end $$;
create trigger reviews_rating after insert or update of status on public.reviews
  for each row execute function public.tg_review_rating();

-- Les avis ne peuvent porter que sur une commande réelle et livrée.
create or replace function public.tg_review_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.orders o where o.id = new.order_id and o.customer_id = new.author_id
                 and o.status in ('delivered','completed')) then
    raise exception 'Avis possible uniquement après une commande livrée' using errcode = '42501';
  end if;
  if new.target_type = 'product' and not exists (
       select 1 from public.order_items i where i.order_id = new.order_id and i.product_id = new.product_id) then
    raise exception 'Ce produit ne fait pas partie de la commande' using errcode = '42501';
  end if;
  if new.target_type = 'store' then
    new.store_id := (select store_id from public.orders where id = new.order_id);
  end if;
  if new.target_type in ('driver','delivery') then
    new.driver_id := (select driver_id from public.delivery_assignments
                      where order_id = new.order_id and status = 'completed' order by delivered_at desc nulls last limit 1);
  end if;
  if auth.uid() is not null and not public.is_super_admin() then
    new.status := 'pending';
  end if;
  return new;
end $$;
create trigger reviews_guard before insert on public.reviews
  for each row execute function public.tg_review_guard();
