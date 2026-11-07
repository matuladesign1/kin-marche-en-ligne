-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Espace Pâtisserie
--
-- * Pâtissiers rattachés à un supermarché : l'accès est donné (et retiré) par l'administrateur
--   général, un agent « Supermarchés » de la zone ou le directeur du magasin. Profil complet
--   (identité, pièce d'identité, spécialités, expérience). Certification par l'administrateur général.
-- * Demandes des clients : gâteaux, pains, viennoiseries, autres. Date et heure souhaitées facultatives,
--   au plus tôt quelques heures après la demande (réglage « pastry.min_lead_hours », 3 h par défaut).
-- * Devis du pâtissier, discussion client ↔ pâtissier, acceptation par le client : une commande Kin Marché
--   normale est créée (paiement, étapes, livreurs, suivi en direct, code de livraison).
-- * Le pâtissier fait avancer les étapes de préparation ; « Prête » appelle un livreur.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pâtissiers
-- ---------------------------------------------------------------------
create table if not exists public.pastry_chefs (
  id uuid primary key references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'suspended')),
  certified boolean not null default false,
  certified_at timestamptz,
  certified_by uuid references auth.users(id),
  display_name text check (length(display_name) <= 80),
  bio text check (length(bio) <= 600),
  specialties text[] not null default '{}',
  years_experience integer check (years_experience between 0 and 80),
  birth_date date,
  gender text check (gender in ('female', 'male', 'other')),
  nationality text check (length(nationality) <= 60),
  id_type text check (id_type in ('voter_card', 'passport', 'driver_license', 'other')),
  id_number text check (length(id_number) <= 40),
  id_photo_path text,
  address text check (length(address) <= 200),
  commune text check (length(commune) <= 80),
  emergency_name text check (length(emergency_name) <= 80),
  emergency_phone text check (length(emergency_phone) <= 30),
  profile_completed_at timestamptz,
  orders_done integer not null default 0,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pastry_chefs_store_idx on public.pastry_chefs (store_id);
drop trigger if exists pastry_chefs_updated on public.pastry_chefs;
create trigger pastry_chefs_updated before update on public.pastry_chefs
  for each row execute function public.tg_set_updated_at();
alter table public.pastry_chefs enable row level security;

-- Pâtissier actif (rôle et compte actifs), éventuellement d'un magasin donné.
create or replace function public.is_pastry_chef(p_store_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pastry_chefs c join public.profiles p on p.id = c.id
    where c.id = auth.uid() and c.status = 'active' and p.role = 'pastry_chef' and p.is_active
      and (p_store_id is null or c.store_id = p_store_id))
$$;

-- Qui gère la pâtisserie d'un magasin : administrateur général, agent « Supermarchés » de la zone, directeur du magasin.
create or replace function public.can_manage_pastry(p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or public.is_store_manager(p_store_id) or public.has_store_permission('stores', p_store_id)
$$;

drop policy if exists "pâtissiers : lecture" on public.pastry_chefs;
create policy "pâtissiers : lecture" on public.pastry_chefs for select to authenticated
  using (id = (select auth.uid()) or public.can_manage_pastry(store_id));

-- Les gestionnaires voient le nom, l'e-mail et le téléphone des pâtissiers de leur magasin.
drop policy if exists "profils : pâtissiers gérés" on public.profiles;
create policy "profils : pâtissiers gérés" on public.profiles for select to authenticated
  using (exists (select 1 from public.pastry_chefs c where c.id = profiles.id and public.can_manage_pastry(c.store_id)));

-- ---------------------------------------------------------------------
-- 2. Demandes pâtisserie (table cake_orders élargie)
-- ---------------------------------------------------------------------
create sequence if not exists public.pastry_number_seq;

alter table public.cake_orders
  add column if not exists category text not null default 'cake',
  add column if not exists quantity integer,
  add column if not exists details text,
  add column if not exists desired_at timestamptz,
  add column if not exists chef_id uuid references public.pastry_chefs(id) on delete set null,
  add column if not exists quote_details text,
  add column if not exists quoted_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists reject_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists request_number text,
  -- Copie de la commande Kin Marché liée (le pâtissier n'a pas accès aux commandes ni aux adresses des clients).
  add column if not exists order_number text,
  add column if not exists order_status text;
alter table public.cake_orders alter column desired_date drop not null;

alter table public.cake_orders drop constraint if exists cake_orders_category_check;
alter table public.cake_orders add constraint cake_orders_category_check
  check (category in ('cake', 'bread', 'viennoiserie', 'other'));
alter table public.cake_orders drop constraint if exists cake_orders_quantity_check;
alter table public.cake_orders add constraint cake_orders_quantity_check check (quantity is null or quantity between 1 and 10000);
alter table public.cake_orders drop constraint if exists cake_orders_texts_check;
alter table public.cake_orders add constraint cake_orders_texts_check check (
  coalesce(length(details), 0) <= 2000 and coalesce(length(quote_details), 0) <= 1000 and coalesce(length(reject_reason), 0) <= 500);
alter table public.cake_orders drop constraint if exists cake_orders_status_check;
alter table public.cake_orders add constraint cake_orders_status_check check (status in (
  'submitted', 'quoted', 'accepted', 'rejected', 'cancelled', 'paid', 'in_preparation', 'ready', 'delivering', 'delivered'));

create index if not exists cake_orders_store_idx on public.cake_orders (store_id, created_at desc);
create index if not exists cake_orders_customer_idx on public.cake_orders (customer_id, created_at desc);
create index if not exists cake_orders_order_idx on public.cake_orders (order_id) where order_id is not null;
create unique index if not exists cake_orders_number_uq on public.cake_orders (request_number) where request_number is not null;

-- Réglages de la pâtisserie (délai minimum en heures, ouverture du service).
insert into public.app_settings (key, value)
values ('pastry', '{"enabled": true, "min_lead_hours": 3}'::jsonb)
on conflict (key) do nothing;

create or replace function public.pastry_min_lead_hours()
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(0, least(72, coalesce((public.setting('pastry')->>'min_lead_hours')::integer, 3)))
$$;

-- Produit technique (invisible dans le catalogue) pour les lignes des commandes pâtisserie.
insert into public.products (sku, name, name_i18n, unit, is_active)
values ('KM-PATISSERIE', 'Pâtisserie sur commande',
        '{"fr": "Pâtisserie sur commande", "en": "Made-to-order pastry", "ln": "Gâteau ya commande", "sw": "Keki ya kuagiza"}'::jsonb,
        'unit', false)
on conflict (sku) do nothing;

-- À la création : numéro de demande, statut initial, date souhaitée, délai minimum, aucun prix fixé par le client.
create or replace function public.tg_cake_order_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_lead integer := public.pastry_min_lead_hours();
begin
  if coalesce((public.setting('pastry')->>'enabled')::boolean, true) is false then
    raise exception 'PASTRY_CLOSED';
  end if;
  if not exists (select 1 from public.stores where id = new.store_id and is_active) then
    raise exception 'STORE_NOT_FOUND';
  end if;
  new.status := 'submitted';
  new.chef_id := null;
  new.quoted_price_usd := null;
  new.quote_details := null;
  new.quoted_at := null;
  new.accepted_at := null;
  new.rejected_at := null;
  new.reject_reason := null;
  new.cancelled_at := null;
  new.order_id := null;
  new.order_number := null;
  new.order_status := null;
  new.bakery_note := null;
  if new.desired_at is null and new.desired_date is not null then
    new.desired_at := (new.desired_date + coalesce(new.desired_time, time '12:00')) at time zone 'Africa/Kinshasa';
  end if;
  if new.desired_at is not null then
    if new.desired_at < now() + make_interval(hours => v_lead) - interval '10 minutes' then
      raise exception 'PASTRY_TOO_SOON' using hint = v_lead::text;
    end if;
    if new.desired_at > now() + interval '120 days' then
      raise exception 'PASTRY_TOO_FAR';
    end if;
    new.desired_date := (new.desired_at at time zone 'Africa/Kinshasa')::date;
    new.desired_time := (new.desired_at at time zone 'Africa/Kinshasa')::time;
  end if;
  new.request_number := 'PT' || to_char(now() at time zone 'Africa/Kinshasa', 'YYMMDD') || '-' ||
                        lpad(nextval('public.pastry_number_seq')::text, 5, '0');
  return new;
end $$;
revoke execute on function public.tg_cake_order_before_insert() from public, anon, authenticated;
drop trigger if exists cake_orders_before_insert on public.cake_orders;
create trigger cake_orders_before_insert before insert on public.cake_orders
  for each row execute function public.tg_cake_order_before_insert();

-- Nouvelle demande : les pâtissiers et les gestionnaires du magasin sont prévenus.
create or replace function public.tg_cake_order_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_when text := case when new.desired_at is null then 'dès que possible'
                      else 'pour le ' || to_char(new.desired_at at time zone 'Africa/Kinshasa', 'DD/MM à HH24"h"MI') end;
begin
  insert into public.notifications (user_id, kind, title, body, data)
  select x.uid, 'pastry_request', 'Nouvelle demande pâtisserie',
         coalesce(new.cake_type, 'Commande') || ' — ' || v_when,
         jsonb_build_object('cake_order_id', new.id, 'screen', 'pastry')
  from (
    select c.id as uid from public.pastry_chefs c join public.profiles p on p.id = c.id
     where c.store_id = new.store_id and c.status = 'active' and p.role = 'pastry_chef' and p.is_active
    union
    select sm.user_id from public.store_managers sm where sm.store_id = new.store_id
  ) x;
  return new;
end $$;
revoke execute on function public.tg_cake_order_after_insert() from public, anon, authenticated;
drop trigger if exists cake_orders_after_insert on public.cake_orders;
create trigger cake_orders_after_insert after insert on public.cake_orders
  for each row execute function public.tg_cake_order_after_insert();

-- Accès à une demande : le client, les pâtissiers du magasin, les gestionnaires.
create or replace function public.can_access_pastry_order(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cake_orders o where o.id = p_id and (
    o.customer_id = auth.uid() or public.is_pastry_chef(o.store_id) or public.can_manage_pastry(o.store_id)))
$$;

drop policy if exists "gâteaux : lecture" on public.cake_orders;
drop policy if exists "pâtisserie : lecture" on public.cake_orders;
create policy "pâtisserie : lecture" on public.cake_orders for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_pastry_chef(store_id) or public.can_manage_pastry(store_id));
-- La création directe par le client reste possible (contrôlée par les déclencheurs ci-dessus).
-- Les mises à jour passent par les fonctions ci-dessous (plus de modification directe par le magasin).
drop policy if exists "gâteaux : devis magasin" on public.cake_orders;

-- ---------------------------------------------------------------------
-- 3. Discussion client ↔ pâtissier
-- ---------------------------------------------------------------------
create table if not exists public.pastry_messages (
  id uuid primary key default gen_random_uuid(),
  cake_order_id uuid not null references public.cake_orders(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists pastry_messages_order_idx on public.pastry_messages (cake_order_id, created_at);
alter table public.pastry_messages enable row level security;
drop policy if exists "pâtisserie messages : lecture" on public.pastry_messages;
create policy "pâtisserie messages : lecture" on public.pastry_messages for select to authenticated
  using (public.can_access_pastry_order(cake_order_id));
drop policy if exists "pâtisserie messages : envoi" on public.pastry_messages;
create policy "pâtisserie messages : envoi" on public.pastry_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.can_access_pastry_order(cake_order_id));

-- Message : notification à l'autre partie (client, ou pâtissier chargé de la commande / pâtissiers du magasin).
create or replace function public.tg_pastry_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_o public.cake_orders;
  v_from_customer boolean;
begin
  select * into v_o from public.cake_orders where id = new.cake_order_id;
  v_from_customer := new.sender_id = v_o.customer_id;
  if v_from_customer then
    insert into public.notifications (user_id, kind, title, body, data)
    select x.uid, 'pastry_message', 'Message du client — ' || coalesce(v_o.request_number, 'pâtisserie'), left(new.body, 140),
           jsonb_build_object('cake_order_id', v_o.id, 'screen', 'pastry')
    from (
      select c.id as uid from public.pastry_chefs c join public.profiles p on p.id = c.id
       where c.store_id = v_o.store_id and c.status = 'active' and p.role = 'pastry_chef' and p.is_active
         and (v_o.chef_id is null or c.id = v_o.chef_id)
    ) x;
  else
    insert into public.notifications (user_id, kind, title, body, data)
    values (v_o.customer_id, 'pastry_message', 'Message de la pâtisserie', left(new.body, 140),
            jsonb_build_object('cake_order_id', v_o.id, 'screen', 'pastry_customer'));
  end if;
  return new;
end $$;
revoke execute on function public.tg_pastry_message_notify() from public, anon, authenticated;
drop trigger if exists pastry_messages_notify on public.pastry_messages;
create trigger pastry_messages_notify after insert on public.pastry_messages
  for each row execute function public.tg_pastry_message_notify();

-- ---------------------------------------------------------------------
-- 4. Accès des pâtissiers (administration)
-- ---------------------------------------------------------------------
create or replace function public.grant_pastry_chef(p_email text, p_store_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
begin
  if p_store_id is null or not public.can_manage_pastry(p_store_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_p from public.profiles where lower(email) = lower(trim(p_email));
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_p.role not in ('customer', 'pastry_chef') then raise exception 'ROLE_CONFLICT' using hint = v_p.role::text; end if;
  -- Un pâtissier actif d'un autre magasin ne peut être déplacé que par qui gère aussi ce magasin.
  if exists (select 1 from public.pastry_chefs c where c.id = v_p.id and c.store_id <> p_store_id and c.status = 'active'
             and not public.can_manage_pastry(c.store_id)) then
    raise exception 'CHEF_OTHER_STORE';
  end if;
  perform set_config('km.trusted', 'on', true);
  update public.profiles set role = 'pastry_chef' where id = v_p.id and role = 'customer';
  perform set_config('km.trusted', 'off', true);
  insert into public.pastry_chefs (id, store_id, display_name, granted_by)
  values (v_p.id, p_store_id, v_p.full_name, auth.uid())
  on conflict (id) do update set store_id = excluded.store_id, status = 'active', granted_by = excluded.granted_by;
  insert into public.notifications (user_id, kind, title, body, data)
  values (v_p.id, 'pastry_role', 'Espace pâtissier ouvert',
          'Complétez votre profil de pâtissier dans l''application pour être certifié Kin Marché.', jsonb_build_object('screen', 'pastry'));
  perform public.write_audit('pastry_chef_grant', 'pastry_chefs', v_p.id::text, jsonb_build_object('store_id', p_store_id));
  return v_p.id;
end $$;

-- Suspendre, réactiver ou retirer l'accès (le compte redevient client).
create or replace function public.set_pastry_chef_status(p_chef uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.pastry_chefs;
begin
  select * into v_c from public.pastry_chefs where id = p_chef for update;
  if not found then raise exception 'CHEF_NOT_FOUND'; end if;
  if not public.can_manage_pastry(v_c.store_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended', 'revoked') then raise exception 'STATUS_INVALID'; end if;
  perform set_config('km.trusted', 'on', true);
  if p_status = 'revoked' then
    update public.pastry_chefs set status = 'suspended', certified = false where id = p_chef;
    update public.profiles set role = 'customer' where id = p_chef and role = 'pastry_chef';
  else
    update public.pastry_chefs set status = p_status where id = p_chef;
    if p_status = 'active' then
      update public.profiles set role = 'pastry_chef' where id = p_chef and role = 'customer';
    end if;
  end if;
  perform set_config('km.trusted', 'off', true);
  insert into public.notifications (user_id, kind, title, body)
  values (p_chef, 'pastry_role',
          case p_status when 'active' then 'Espace pâtissier réactivé' when 'suspended' then 'Espace pâtissier suspendu'
                        else 'Accès pâtissier retiré' end,
          case p_status when 'active' then 'Vous pouvez de nouveau recevoir des commandes.'
                        else 'Contactez votre supermarché pour plus d''informations.' end);
  perform public.write_audit('pastry_chef_status', 'pastry_chefs', p_chef::text, jsonb_build_object('status', p_status));
end $$;

-- Certification : réservée à l'administrateur général, sur un profil complet.
create or replace function public.certify_pastry_chef(p_chef uuid, p_certified boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.pastry_chefs;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_c from public.pastry_chefs where id = p_chef for update;
  if not found then raise exception 'CHEF_NOT_FOUND'; end if;
  if p_certified and v_c.profile_completed_at is null then raise exception 'PROFILE_INCOMPLETE'; end if;
  update public.pastry_chefs
     set certified = p_certified,
         certified_at = case when p_certified then now() else null end,
         certified_by = case when p_certified then auth.uid() else null end
   where id = p_chef;
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_chef, 'pastry_role',
          case when p_certified then 'Pâtissier certifié Kin Marché' else 'Certification retirée' end,
          case when p_certified then 'Félicitations : le badge « Pâtissier certifié » s''affiche désormais auprès des clients.'
               else 'Votre badge de pâtissier certifié a été retiré par l''administration.' end,
          jsonb_build_object('screen', 'pastry'));
  perform public.write_audit('pastry_chef_certify', 'pastry_chefs', p_chef::text, jsonb_build_object('certified', p_certified));
end $$;

-- ---------------------------------------------------------------------
-- 5. Profil du pâtissier (rempli par lui-même)
-- ---------------------------------------------------------------------
create or replace function public.save_pastry_profile(
  p_display_name text, p_bio text, p_specialties text[], p_years integer,
  p_birth_date date, p_gender text, p_nationality text,
  p_id_type text, p_id_number text, p_id_photo_path text,
  p_address text, p_commune text, p_emergency_name text, p_emergency_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_c public.pastry_chefs;
  v_phone text;
  v_complete boolean;
  v_id_changed boolean;
begin
  select * into v_c from public.pastry_chefs where id = v_uid for update;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_id_photo_path is not null and split_part(p_id_photo_path, '/', 1) <> v_uid::text then
    raise exception 'INVALID_DOCUMENT';
  end if;
  if p_birth_date is not null and (p_birth_date > (now() - interval '16 years')::date or p_birth_date < date '1930-01-01') then
    raise exception 'INVALID_BIRTH_DATE';
  end if;
  v_id_changed := coalesce(v_c.id_number, '') <> coalesce(nullif(trim(p_id_number), ''), '')
               or coalesce(v_c.id_type, '') <> coalesce(p_id_type, '')
               or coalesce(v_c.id_photo_path, '') <> coalesce(p_id_photo_path, v_c.id_photo_path, '');
  update public.pastry_chefs set
    display_name = nullif(trim(p_display_name), ''),
    bio = nullif(trim(p_bio), ''),
    specialties = coalesce((select array_agg(distinct trim(s)) from unnest(coalesce(p_specialties, '{}')) s where trim(s) <> ''), '{}'),
    years_experience = p_years,
    birth_date = p_birth_date,
    gender = p_gender,
    nationality = nullif(trim(p_nationality), ''),
    id_type = p_id_type,
    id_number = nullif(trim(p_id_number), ''),
    id_photo_path = coalesce(p_id_photo_path, id_photo_path),
    address = nullif(trim(p_address), ''),
    commune = nullif(trim(p_commune), ''),
    emergency_name = nullif(trim(p_emergency_name), ''),
    emergency_phone = nullif(trim(p_emergency_phone), ''),
    -- Une pièce d'identité modifiée après certification doit être revue par l'administration.
    certified = case when v_id_changed then false else certified end,
    certified_at = case when v_id_changed then null else certified_at end
  where id = v_uid
  returning * into v_c;
  select phone into v_phone from public.profiles where id = v_uid;
  v_complete := v_c.display_name is not null and v_c.birth_date is not null and v_c.id_type is not null
            and v_c.id_number is not null and v_c.id_photo_path is not null and v_c.address is not null
            and v_c.commune is not null and coalesce(trim(v_phone), '') <> '' and cardinality(v_c.specialties) > 0;
  if v_complete and v_c.profile_completed_at is null then
    update public.pastry_chefs set profile_completed_at = now() where id = v_uid;
    insert into public.notifications (user_id, kind, title, body, data)
    select p.id, 'pastry_profile', 'Profil pâtissier à certifier', coalesce(v_c.display_name, ''), jsonb_build_object('chef_id', v_uid)
    from public.profiles p where p.role = 'super_admin' and p.is_active;
  elsif not v_complete and v_c.profile_completed_at is not null then
    update public.pastry_chefs set profile_completed_at = null where id = v_uid;
  end if;
  return jsonb_build_object('completed', v_complete, 'certified', v_c.certified and not v_id_changed);
end $$;

-- Carte publique d'un pâtissier (pour le client) : jamais l'identité ni le téléphone.
create or replace function public.pastry_chef_card(p_chef uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', coalesce(c.display_name, p.full_name), 'avatar_url', p.avatar_url,
    'certified', c.certified, 'specialties', c.specialties, 'years_experience', c.years_experience,
    'bio', c.bio, 'orders_done', c.orders_done)
  from public.pastry_chefs c join public.profiles p on p.id = c.id
  where c.id = p_chef
$$;

-- ---------------------------------------------------------------------
-- 6. Devis, refus, acceptation, annulation
-- ---------------------------------------------------------------------
create or replace function public.pastry_quote(p_id uuid, p_price numeric, p_details text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_o public.cake_orders;
begin
  select * into v_o from public.cake_orders where id = p_id for update;
  if not found then raise exception 'PASTRY_ORDER_NOT_FOUND'; end if;
  if not public.is_pastry_chef(v_o.store_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_o.chef_id is not null and v_o.chef_id <> auth.uid() then raise exception 'ALREADY_TAKEN'; end if;
  if v_o.status not in ('submitted', 'quoted') then raise exception 'TRANSITION_NOT_ALLOWED'; end if;
  if p_price is null or p_price <= 0 or p_price > 100000 then raise exception 'INVALID_PRICE'; end if;
  update public.cake_orders
     set chef_id = auth.uid(), quoted_price_usd = round(p_price, 2), quote_details = nullif(trim(p_details), ''),
         quoted_at = now(), status = 'quoted'
   where id = p_id;
  insert into public.notifications (user_id, kind, title, body, data)
  values (v_o.customer_id, 'pastry_quote', 'Le prix de votre commande pâtisserie est prêt',
          coalesce(v_o.cake_type, 'Commande') || ' : ' || to_char(round(p_price, 2), 'FM999G990D00') || ' $US. Acceptez pour payer.',
          jsonb_build_object('cake_order_id', p_id, 'screen', 'pastry_customer'));
end $$;

create or replace function public.pastry_take(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_o public.cake_orders;
begin
  select * into v_o from public.cake_orders where id = p_id for update;
  if not found then raise exception 'PASTRY_ORDER_NOT_FOUND'; end if;
  if not public.is_pastry_chef(v_o.store_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_o.chef_id is not null and v_o.chef_id <> auth.uid() then raise exception 'ALREADY_TAKEN'; end if;
  if v_o.status in ('rejected', 'cancelled', 'delivered') then raise exception 'TRANSITION_NOT_ALLOWED'; end if;
  update public.cake_orders set chef_id = auth.uid() where id = p_id;
end $$;

create or replace function public.pastry_reject(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_o public.cake_orders;
begin
  select * into v_o from public.cake_orders where id = p_id for update;
  if not found then raise exception 'PASTRY_ORDER_NOT_FOUND'; end if;
  if not (public.is_pastry_chef(v_o.store_id) or public.can_manage_pastry(v_o.store_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_o.chef_id is not null and v_o.chef_id <> auth.uid() and not public.can_manage_pastry(v_o.store_id) then
    raise exception 'ALREADY_TAKEN';
  end if;
  if v_o.status not in ('submitted', 'quoted') then raise exception 'TRANSITION_NOT_ALLOWED'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  update public.cake_orders
     set status = 'rejected', rejected_at = now(), reject_reason = trim(p_reason),
         chef_id = coalesce(chef_id, case when public.is_pastry_chef(v_o.store_id) then auth.uid() end)
   where id = p_id;
  insert into public.notifications (user_id, kind, title, body, data)
  values (v_o.customer_id, 'pastry_quote', 'Commande pâtisserie non retenue', trim(p_reason),
          jsonb_build_object('cake_order_id', p_id, 'screen', 'pastry_customer'));
end $$;

-- Le client accepte le prix : une commande Kin Marché est créée (paiement, préparation, livreur, suivi).
create or replace function public.pastry_accept_quote(p_id uuid, p_address_id uuid, p_instructions text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_o public.cake_orders;
  v_store public.stores;
  v_addr public.addresses;
  v_profile public.profiles;
  v_dist double precision;
  v_ok boolean;
  v_fee numeric;
  v_rate numeric := public.current_tax_rate();
  v_tax numeric;
  v_total numeric;
  v_product uuid;
  v_order_id uuid;
  v_number text;
  v_address jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_o from public.cake_orders where id = p_id for update;
  if not found or v_o.customer_id <> v_uid then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_o.status <> 'quoted' or v_o.quoted_price_usd is null then raise exception 'TRANSITION_NOT_ALLOWED'; end if;
  select * into v_store from public.stores where id = v_o.store_id and is_active;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  select * into v_addr from public.addresses where id = p_address_id and user_id = v_uid;
  if not found then raise exception 'ADDRESS_NOT_FOUND'; end if;
  select * into v_profile from public.profiles where id = v_uid;

  v_dist := public.distance_km(v_addr.latitude, v_addr.longitude, v_store.latitude, v_store.longitude);
  if v_dist is not null then
    v_ok := v_dist <= v_store.delivery_radius_km;
  else
    v_ok := v_store.delivery_zone is not null and v_store.delivery_zone ? v_addr.commune;
  end if;
  if not v_ok then
    raise exception '%', case when v_dist is null then 'ADDRESS_NEEDS_GPS' else 'OUT_OF_DELIVERY_ZONE' end;
  end if;
  v_fee := round(v_store.delivery_fee_usd + coalesce(v_dist, 0)::numeric * v_store.delivery_fee_per_km_usd, 2);
  v_tax := round(v_o.quoted_price_usd * coalesce(v_rate, 0) / 100, 2);
  v_total := round(v_o.quoted_price_usd + v_fee + v_tax, 2);

  select id into v_product from public.products where sku = 'KM-PATISSERIE';
  if v_product is null then raise exception 'PASTRY_PRODUCT_MISSING'; end if;

  v_address := jsonb_build_object(
    'label', v_addr.label,
    'recipient_name', coalesce(v_addr.recipient_name, v_o.full_name, v_profile.full_name),
    'recipient_phone', coalesce(v_addr.recipient_phone, v_o.phone, v_profile.phone),
    'province', v_addr.province, 'city', v_addr.city, 'commune', v_addr.commune,
    'quartier', v_addr.quartier, 'avenue', v_addr.avenue, 'street_number', v_addr.street_number,
    'landmark', v_addr.landmark, 'latitude', v_addr.latitude, 'longitude', v_addr.longitude,
    'distance_km', case when v_dist is null then null else round(v_dist::numeric, 2) end);

  v_number := 'KM' || to_char(now() at time zone 'Africa/Kinshasa', 'YYMMDD') || '-' ||
              lpad(nextval('public.order_number_seq')::text, 6, '0');
  insert into public.orders (
    order_number, customer_id, store_id, subtotal_usd, delivery_fee_usd, tax_rate, tax_usd, total_usd,
    delivery_address, delivery_instructions)
  values (
    v_number, v_uid, v_o.store_id, v_o.quoted_price_usd, v_fee, coalesce(v_rate, 0), v_tax, v_total,
    v_address,
    left(concat_ws(' — ', 'Pâtisserie ' || coalesce(v_o.request_number, ''),
      case when v_o.desired_at is not null
           then 'souhaitée le ' || to_char(v_o.desired_at at time zone 'Africa/Kinshasa', 'DD/MM à HH24"h"MI') end,
      nullif(trim(p_instructions), '')), 500))
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, inventory_id, product_name, unit, unit_price_usd, quantity, line_total_usd)
  values (v_order_id, v_product, null, left('Pâtisserie : ' || coalesce(v_o.cake_type, 'commande'), 200), 'unit',
          v_o.quoted_price_usd, 1, v_o.quoted_price_usd);

  update public.cake_orders
     set status = 'accepted', accepted_at = now(), order_id = v_order_id, order_number = v_number, order_status = 'received',
         delivery_address = v_address
   where id = p_id;

  insert into public.notifications (user_id, kind, title, body, data)
  select x.uid, 'pastry_request', 'Prix accepté par le client', 'Commande ' || coalesce(v_o.request_number, '') || ' : en attente du paiement.',
         jsonb_build_object('cake_order_id', p_id, 'screen', 'pastry')
  from (select v_o.chef_id as uid where v_o.chef_id is not null) x;

  perform public.write_audit('pastry_quote_accepted', 'cake_orders', p_id::text,
    jsonb_build_object('order_id', v_order_id, 'total_usd', v_total));
  return jsonb_build_object('order_id', v_order_id, 'order_number', v_number, 'total_usd', v_total,
                            'delivery_fee_usd', v_fee, 'tax_usd', v_tax);
end $$;

-- Annulation avant paiement (client, ou gestionnaire du magasin).
create or replace function public.pastry_cancel(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_o public.cake_orders;
  v_order public.orders;
  v_is_customer boolean;
begin
  select * into v_o from public.cake_orders where id = p_id for update;
  if not found then raise exception 'PASTRY_ORDER_NOT_FOUND'; end if;
  v_is_customer := v_o.customer_id = auth.uid();
  if not (v_is_customer or public.can_manage_pastry(v_o.store_id)) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_o.status not in ('submitted', 'quoted', 'accepted') then raise exception 'PASTRY_NOT_CANCELLABLE'; end if;
  if v_o.order_id is not null then
    select * into v_order from public.orders where id = v_o.order_id for update;
    if v_order.payment_status not in ('pending', 'failed', 'cancelled')
       or exists (select 1 from public.payments where order_id = v_order.id and status in ('processing', 'succeeded')) then
      raise exception 'PAYMENT_IN_PROGRESS';
    end if;
  end if;
  -- La demande d'abord (la commande annulée ensuite ne la remet pas au stade « prix proposé »).
  update public.cake_orders set status = 'cancelled', cancelled_at = now(),
         reject_reason = coalesce(nullif(trim(p_reason), ''), reject_reason)
   where id = p_id;
  if v_o.order_id is not null then
    perform public._release_order(v_o.order_id);
    update public.orders set status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(),
           cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Commande pâtisserie annulée')
     where id = v_o.order_id and status = 'received';
  end if;
  if v_is_customer then
    insert into public.notifications (user_id, kind, title, body, data)
    select x.uid, 'pastry_request', 'Commande pâtisserie annulée par le client', coalesce(v_o.request_number, ''),
           jsonb_build_object('cake_order_id', p_id, 'screen', 'pastry')
    from (select v_o.chef_id as uid where v_o.chef_id is not null) x;
  else
    insert into public.notifications (user_id, kind, title, body, data)
    values (v_o.customer_id, 'pastry_quote', 'Commande pâtisserie annulée', coalesce(nullif(trim(p_reason), ''), v_o.request_number),
            jsonb_build_object('cake_order_id', p_id, 'screen', 'pastry_customer'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Étapes de préparation par le pâtissier (commande payée), puis livreur
-- ---------------------------------------------------------------------
create or replace function public.pastry_advance(p_id uuid, p_status public.order_status)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_o public.cake_orders;
  v_order public.orders;
begin
  select * into v_o from public.cake_orders where id = p_id for update;
  if not found or v_o.order_id is null then raise exception 'PASTRY_ORDER_NOT_FOUND'; end if;
  if not (public.is_pastry_chef(v_o.store_id) or public.can_manage_pastry(v_o.store_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if public.is_pastry_chef(v_o.store_id) and v_o.chef_id is not null and v_o.chef_id <> auth.uid()
     and not public.can_manage_pastry(v_o.store_id) then
    raise exception 'ALREADY_TAKEN';
  end if;
  select * into v_order from public.orders where id = v_o.order_id for update;
  if v_order.payment_status <> 'succeeded' then raise exception 'ORDER_NOT_PAID'; end if;
  if (v_order.status::text || '>' || p_status::text) not in (
       'sent_to_store>preparing', 'preparing>verified', 'verified>packed', 'packed>ready') then
    raise exception 'TRANSITION_NOT_ALLOWED' using detail = v_order.status::text || ' -> ' || p_status::text;
  end if;
  if v_o.chef_id is null and public.is_pastry_chef(v_o.store_id) then
    update public.cake_orders set chef_id = auth.uid() where id = p_id;
  end if;
  update public.orders set status = p_status where id = v_order.id;
  if p_status = 'ready' then
    perform public.assign_next_driver(v_order.id);
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- Le pâtissier chargé d'une commande pâtisserie payée peut appeler un livreur (« Prête »).
create or replace function public.is_pastry_order_chef(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cake_orders c where c.order_id = p_order_id
                 and public.is_pastry_chef(c.store_id) and (c.chef_id is null or c.chef_id = auth.uid()))
$$;
revoke execute on function public.is_pastry_order_chef(uuid) from public, anon;
grant execute on function public.is_pastry_order_chef(uuid) to authenticated;

-- Attribution du livreur : identique, ouverte au pâtissier de la commande ; le pâtissier est aussi prévenu
-- s'il n'y a aucun livreur disponible.
create or replace function public.assign_next_driver(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_store public.stores;
  v_weight numeric;
  v_driver uuid;
  v_dist double precision;
  v_timeout integer := coalesce((public.setting('delivery')->>'offer_timeout_seconds')::integer, 120);
begin
  if auth.uid() is not null and not (public.is_super_admin() or public.is_order_store_manager(p_order_id)
                                     or public.is_pastry_order_chef(p_order_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status <> 'ready' or v_order.payment_status <> 'succeeded' then return null; end if;
  if exists (select 1 from public.delivery_assignments where order_id = p_order_id and status in ('offered','accepted')) then
    return null;
  end if;
  select * into v_store from public.stores where id = v_order.store_id;
  select coalesce(sum(oi.quantity * coalesce(p.weight_kg, case when oi.unit = 'kg' then 1 else 0 end)), 0)
    into v_weight from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = p_order_id;

  select d.id, public.distance_km(d.current_latitude, d.current_longitude, v_store.latitude, v_store.longitude)
    into v_driver, v_dist
  from public.drivers d
  join public.profiles pr on pr.id = d.id and pr.is_active and pr.role = 'driver'
  left join lateral (
    select v.max_weight_kg from public.driver_vehicles v where v.driver_id = d.id order by v.is_primary desc limit 1
  ) veh on true
  where d.status = 'verified'
    and d.is_available
    and (cardinality(d.zone_communes) = 0 or v_store.commune = any(d.zone_communes)
         or (v_order.delivery_address->>'commune') = any(d.zone_communes))
    and (veh.max_weight_kg is null or veh.max_weight_kg >= v_weight)
    and (select count(*) from public.delivery_assignments a
         where a.driver_id = d.id and a.status = 'accepted') < d.max_active_orders
    and not exists (select 1 from public.delivery_assignments a
         where a.order_id = p_order_id and a.driver_id = d.id)
  order by
    public.distance_km(d.current_latitude, d.current_longitude, v_store.latitude, v_store.longitude) asc nulls last,
    (select count(*) from public.delivery_assignments a where a.driver_id = d.id and a.status = 'accepted') asc,
    d.rating desc
  limit 1;

  if v_driver is null then
    insert into public.notifications (user_id, kind, title, body, data)
    select x.uid, 'no_driver', 'Aucun livreur disponible', 'Commande ' || v_order.order_number,
           jsonb_build_object('order_id', p_order_id)
    from (
      select sm.user_id as uid from public.store_managers sm where sm.store_id = v_order.store_id
      union
      select c.chef_id from public.cake_orders c where c.order_id = p_order_id and c.chef_id is not null
    ) x;
    return null;
  end if;

  insert into public.delivery_assignments (order_id, driver_id, distance_km, expires_at)
  values (p_order_id, v_driver, round(v_dist::numeric, 2), now() + make_interval(secs => v_timeout));

  insert into public.notifications (user_id, kind, title, body, data)
  values (v_driver, 'delivery_offer', 'Nouvelle mission proposée',
          v_store.name || ' → ' || coalesce(v_order.delivery_address->>'commune', ''),
          jsonb_build_object('order_id', p_order_id, 'store_id', v_store.id,
                             'store_commune', v_store.commune,
                             'customer_commune', v_order.delivery_address->>'commune',
                             'delivery_fee_usd', v_order.delivery_fee_usd));
  return v_driver;
end $$;

-- La demande suit la commande : payée, en préparation, prête, en livraison, livrée, annulée.
create or replace function public.tg_orders_pastry_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_o public.cake_orders;
  v_status text;
begin
  select * into v_o from public.cake_orders where order_id = new.id;
  if not found then return new; end if;
  -- Commande non payée annulée (délai de paiement dépassé, annulation de la commande) : le prix proposé reste valable,
  -- la demande revient au stade « prix proposé » et le client peut l'accepter de nouveau.
  if v_o.status = 'accepted' and new.status in ('cancelled', 'failed') and new.payment_status <> 'succeeded' then
    update public.cake_orders
       set status = 'quoted', order_id = null, order_number = null, order_status = null, accepted_at = null
     where id = v_o.id;
    insert into public.notifications (user_id, kind, title, body, data)
    values (v_o.customer_id, 'pastry_quote', 'Paiement de la pâtisserie non reçu',
            'Le prix proposé reste valable : acceptez-le de nouveau pour payer votre commande ' || coalesce(v_o.request_number, '') || '.',
            jsonb_build_object('cake_order_id', v_o.id, 'screen', 'pastry_customer'));
    return new;
  end if;
  v_status := case
    when new.status in ('cancelled', 'failed', 'refunded') then 'cancelled'
    when new.status in ('delivered', 'completed') then 'delivered'
    when new.status in ('picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check') then 'delivering'
    when new.status in ('ready', 'driver_assigned', 'driver_to_store') then 'ready'
    when new.status in ('preparing', 'verified', 'packed') then 'in_preparation'
    when new.payment_status = 'succeeded' then 'paid'
    else v_o.status end;
  if v_status is distinct from v_o.status or new.status::text is distinct from v_o.order_status then
    update public.cake_orders set status = v_status, order_status = new.status::text,
           cancelled_at = case when v_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
     where id = v_o.id;
  end if;
  if v_status is distinct from v_o.status then
    if v_status = 'paid' then
      insert into public.notifications (user_id, kind, title, body, data)
      select x.uid, 'pastry_request', 'Commande pâtisserie payée : à préparer',
             coalesce(v_o.cake_type, 'Commande') || ' — ' || coalesce(v_o.request_number, ''),
             jsonb_build_object('cake_order_id', v_o.id, 'screen', 'pastry')
      from (
        select c.id as uid from public.pastry_chefs c join public.profiles p on p.id = c.id
         where c.store_id = v_o.store_id and c.status = 'active' and p.role = 'pastry_chef' and p.is_active
           and (v_o.chef_id is null or c.id = v_o.chef_id)
      ) x;
    elsif v_status = 'delivered' and v_o.chef_id is not null then
      update public.pastry_chefs set orders_done = orders_done + 1 where id = v_o.chef_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_orders_pastry_sync() from public, anon, authenticated;
drop trigger if exists orders_pastry_sync on public.orders;
create trigger orders_pastry_sync after update of status, payment_status on public.orders
  for each row execute function public.tg_orders_pastry_sync();

-- ---------------------------------------------------------------------
-- 8. Réglages (administrateur général)
-- ---------------------------------------------------------------------
create or replace function public.save_pastry_settings(p_enabled boolean, p_min_lead_hours integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_min_lead_hours is null or p_min_lead_hours < 0 or p_min_lead_hours > 72 then raise exception 'INVALID_LEAD'; end if;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values ('pastry', jsonb_build_object('enabled', coalesce(p_enabled, true), 'min_lead_hours', p_min_lead_hours), now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.write_audit('pastry_settings', 'app_settings', 'pastry',
    jsonb_build_object('enabled', p_enabled, 'min_lead_hours', p_min_lead_hours));
end $$;

-- ---------------------------------------------------------------------
-- 9. Fichiers : photos de référence (pâtissiers du magasin) et pièces d'identité des pâtissiers (privées)
-- ---------------------------------------------------------------------
drop policy if exists "km gâteaux : lecture" on storage.objects;
create policy "km gâteaux : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'cake-references' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_super_admin()
    or public.current_app_role() = 'store_admin'
    or exists (select 1 from public.cake_orders o where o.reference_photo_path = objects.name
               and (public.is_pastry_chef(o.store_id) or public.can_manage_pastry(o.store_id)))));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pastry-documents', 'pastry-documents', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "km documents pâtissier : lecture" on storage.objects;
create policy "km documents pâtissier : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'pastry-documents' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.pastry_chefs c where c.id::text = (storage.foldername(name))[1]
               and public.can_manage_pastry(c.store_id))));
drop policy if exists "km documents pâtissier : dépôt" on storage.objects;
create policy "km documents pâtissier : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'pastry-documents' and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.is_pastry_chef());

-- ---------------------------------------------------------------------
-- 10. Supermarchés qui proposent la pâtisserie (au moins un pâtissier actif) — pour le choix du client
-- ---------------------------------------------------------------------
create or replace function public.pastry_stores()
returns table (store_id uuid, chefs integer, certified integer)
language sql stable security definer set search_path = '' as $$
  select c.store_id, count(*)::integer, (count(*) filter (where c.certified))::integer
  from public.pastry_chefs c
  join public.profiles p on p.id = c.id
  join public.stores s on s.id = c.store_id and s.is_active
  where c.status = 'active' and p.role = 'pastry_chef' and p.is_active
  group by c.store_id
$$;

-- Un pâtissier, comme un livreur, ne reçoit pas les notifications réservées aux clients (promotions, roue, fidélité…).
create or replace function public.tg_notification_driver_filter()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public._customer_only_kind(new.kind)
     and exists (select 1 from public.profiles where id = new.user_id and role in ('driver', 'pastry_chef')) then
    return null;   -- notification de client : ni enregistrée, ni envoyée en push
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 11. Temps réel et droits d'exécution
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.cake_orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.pastry_messages;
  exception when duplicate_object then null;
  end;
end $$;

revoke execute on function public.is_pastry_chef(uuid) from public, anon;
revoke execute on function public.can_manage_pastry(uuid) from public, anon;
revoke execute on function public.pastry_min_lead_hours() from public;
revoke execute on function public.can_access_pastry_order(uuid) from public, anon;
revoke execute on function public.grant_pastry_chef(text, uuid) from public, anon;
revoke execute on function public.set_pastry_chef_status(uuid, text) from public, anon;
revoke execute on function public.certify_pastry_chef(uuid, boolean) from public, anon;
revoke execute on function public.save_pastry_profile(text, text, text[], integer, date, text, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.pastry_chef_card(uuid) from public, anon;
revoke execute on function public.pastry_quote(uuid, numeric, text) from public, anon;
revoke execute on function public.pastry_take(uuid) from public, anon;
revoke execute on function public.pastry_reject(uuid, text) from public, anon;
revoke execute on function public.pastry_accept_quote(uuid, uuid, text) from public, anon;
revoke execute on function public.pastry_cancel(uuid, text) from public, anon;
revoke execute on function public.pastry_advance(uuid, public.order_status) from public, anon;
revoke execute on function public.save_pastry_settings(boolean, integer) from public, anon;
revoke execute on function public.pastry_stores() from public;
revoke execute on function public.tg_notification_driver_filter() from public, anon, authenticated;

grant execute on function public.is_pastry_chef(uuid) to authenticated;
grant execute on function public.can_manage_pastry(uuid) to authenticated;
grant execute on function public.pastry_min_lead_hours() to anon, authenticated;
grant execute on function public.can_access_pastry_order(uuid) to authenticated;
grant execute on function public.grant_pastry_chef(text, uuid) to authenticated;
grant execute on function public.set_pastry_chef_status(uuid, text) to authenticated;
grant execute on function public.certify_pastry_chef(uuid, boolean) to authenticated;
grant execute on function public.save_pastry_profile(text, text, text[], integer, date, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.pastry_chef_card(uuid) to authenticated;
grant execute on function public.pastry_quote(uuid, numeric, text) to authenticated;
grant execute on function public.pastry_take(uuid) to authenticated;
grant execute on function public.pastry_reject(uuid, text) to authenticated;
grant execute on function public.pastry_accept_quote(uuid, uuid, text) to authenticated;
grant execute on function public.pastry_cancel(uuid, text) to authenticated;
grant execute on function public.pastry_advance(uuid, public.order_status) to authenticated;
grant execute on function public.save_pastry_settings(boolean, integer) to authenticated;
grant execute on function public.pastry_stores() to anon, authenticated;
