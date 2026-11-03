-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Carte Kin Marché Fidélité et badge livreur certifié.
-- * Numéro de carte = numéro de téléphone du compte (243 + 9 chiffres),
--   comme sur la carte du programme en magasin (QR code et code-barres).
-- * Carte Argent émise automatiquement au premier achat payé d'au moins
--   16 000 FC ; Gold et Platinum basculés uniquement par l'administrateur
--   général ou un administrateur de supermarché.
-- * Points crédités dès la confirmation du paiement (bonus Gold +10 %,
--   Platinum +25 %), retirés si la commande est annulée ou remboursée.
-- * Membres existants de Kin Marché Fidélité : import de l'export du
--   programme et liaison automatique par numéro de téléphone. Les points
--   importés restent bloqués jusqu'à la vérification par l'administration
--   (le téléphone saisi à l'inscription n'est pas vérifié par SMS).
-- * File des opérations à reporter dans l'espace Kin Marché Fidélité
--   (export manuel aujourd'hui, connecteur dès qu'un accès API existe).
-- * Suivi de commande : le client voit si son livreur est certifié.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Outils
-- ---------------------------------------------------------------------

-- Numéro de carte normalisé à partir d'un téléphone saisi librement :
-- +243 81 234 5678, 0812345678, 00243…, 812345678 -> 243812345678.
create or replace function public.km_card_number(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d ~ '^243[0-9]{9}$' then d
    when d ~ '^00243[0-9]{9}$' then substr(d, 3)
    when d ~ '^0[0-9]{9}$' then '243' || substr(d, 2)
    when d ~ '^[1-9][0-9]{8}$' then '243' || d
    else null end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s
$$;

create or replace function public._loyalty_tier_rank(p_tier text)
returns integer language sql immutable set search_path = '' as $$
  select case p_tier when 'silver' then 1 when 'gold' then 2 when 'platinum' then 3 else 0 end
$$;

create or replace function public._loyalty_tier_label(p_tier text)
returns text language sql immutable set search_path = '' as $$
  select case p_tier when 'gold' then 'Gold' when 'platinum' then 'Platinum' when 'silver' then 'Argent' else '' end
$$;

-- Niveau lu dans un fichier d'export : « Membre Argent », « GOLD », « Platine »…
create or replace function public._loyalty_tier_from_text(p_text text)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_text, '') ~* 'plat' then 'platinum'
    when coalesce(p_text, '') ~* '(gold|^\s*or\s*$|dor)' then 'gold'
    else 'silver' end
$$;

-- ---------------------------------------------------------------------
-- 2. Comptes fidélité : carte, statut, niveau manuel, liaison
-- ---------------------------------------------------------------------

alter table public.loyalty_accounts
  add column if not exists card_number text,
  add column if not exists card_status text not null default 'none',
  add column if not exists card_issued_at timestamptz,
  add column if not exists enrollment_source text,
  add column if not exists enrollment_order_id uuid references public.orders(id) on delete set null,
  add column if not exists enroll_eligible_at timestamptz,
  add column if not exists tier_changed_at timestamptz,
  add column if not exists tier_changed_by uuid references public.profiles(id) on delete set null,
  add column if not exists locked_points integer not null default 0,
  add column if not exists points_pushed_pending integer not null default 0,
  add column if not exists external_member_id uuid,
  add column if not exists external_linked_at timestamptz,
  add column if not exists link_verified_at timestamptz,
  add column if not exists link_verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists link_blocked boolean not null default false;

-- L'ancien classement automatique (bronze / silver / gold selon les points) est remplacé :
-- sans carte, pas de niveau ; Argent à l'adhésion ; Gold et Platinum sur décision de l'administration.
update public.loyalty_accounts set tier = 'none' where card_status = 'none';
alter table public.loyalty_accounts alter column tier set default 'none';

alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_tier_chk;
alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_card_status_chk;
alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_source_chk;
alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_card_chk;
alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_locked_chk;
alter table public.loyalty_accounts
  add constraint loyalty_accounts_tier_chk check (tier in ('none', 'silver', 'gold', 'platinum')),
  add constraint loyalty_accounts_card_status_chk check (card_status in ('none', 'active', 'suspended')),
  add constraint loyalty_accounts_source_chk check (enrollment_source is null or enrollment_source in ('purchase', 'program', 'admin')),
  add constraint loyalty_accounts_card_chk check (
    (card_status = 'none' and tier = 'none') or (card_status <> 'none' and tier <> 'none' and card_number ~ '^243[0-9]{9}$')),
  add constraint loyalty_accounts_locked_chk check (locked_points >= 0 and locked_points <= greatest(points_balance, 0));

create unique index if not exists loyalty_accounts_card_number_key
  on public.loyalty_accounts (card_number) where card_number is not null;
create index if not exists profiles_card_number_idx on public.profiles (public.km_card_number(phone));

alter table public.loyalty_transactions
  add column if not exists source text not null default 'app';
alter table public.loyalty_transactions drop constraint if exists loyalty_transactions_source_chk;
alter table public.loyalty_transactions
  add constraint loyalty_transactions_source_chk check (source in ('app', 'program'));
create index if not exists loyalty_tx_order_idx on public.loyalty_transactions (order_id) where order_id is not null;

-- ---------------------------------------------------------------------
-- 3. Membres du programme en magasin, journal des cartes, file d'export
-- ---------------------------------------------------------------------

create table if not exists public.loyalty_program_members (
  id uuid primary key default gen_random_uuid(),
  card_number text not null unique check (card_number ~ '^243[0-9]{9}$'),
  full_name text,
  tier text not null default 'silver' check (tier in ('silver', 'gold', 'platinum')),
  points integer not null default 0 check (points >= 0),
  points_applied integer not null default 0,
  external_ref text,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id) on delete set null,
  linked_user_id uuid unique references public.profiles(id) on delete set null,
  linked_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_external_member_fkey;
alter table public.loyalty_accounts
  add constraint loyalty_accounts_external_member_fkey
  foreign key (external_member_id) references public.loyalty_program_members(id) on delete set null;

create table if not exists public.loyalty_card_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_card_events_user_idx on public.loyalty_card_events (user_id, created_at desc);
create index if not exists loyalty_card_events_recent_idx on public.loyalty_card_events (created_at desc);

create table if not exists public.loyalty_sync_queue (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  card_number text not null,
  kind text not null check (kind in ('enroll', 'points', 'tier', 'status')),
  points integer not null default 0,
  tier text,
  card_status text,
  reference text,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.profiles(id) on delete set null
);
create index if not exists loyalty_sync_queue_status_idx on public.loyalty_sync_queue (status, id);

-- Administration de la fidélité : administrateur général et administrateurs de supermarché.
create or replace function public.can_manage_loyalty()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (select 1 from public.managed_store_ids())
$$;

alter table public.loyalty_program_members enable row level security;
alter table public.loyalty_card_events enable row level security;
alter table public.loyalty_sync_queue enable row level security;

drop policy if exists "membres fidélité : administration" on public.loyalty_program_members;
create policy "membres fidélité : administration" on public.loyalty_program_members
  for select to authenticated using ((select public.is_super_admin()));

drop policy if exists "journal carte : soi-même ou administration" on public.loyalty_card_events;
create policy "journal carte : soi-même ou administration" on public.loyalty_card_events
  for select to authenticated using (user_id = (select auth.uid()) or (select public.can_manage_loyalty()));

drop policy if exists "file fidélité : administration" on public.loyalty_sync_queue;
create policy "file fidélité : administration" on public.loyalty_sync_queue
  for select to authenticated using ((select public.is_super_admin()));

-- ---------------------------------------------------------------------
-- 4. Fonctions internes
-- ---------------------------------------------------------------------

create or replace function public._loyalty_event(p_user uuid, p_kind text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.loyalty_card_events (user_id, kind, details, actor_id)
  values (p_user, p_kind, coalesce(p_details, '{}'::jsonb), auth.uid())
$$;

-- Opération à reporter dans l'espace Kin Marché Fidélité (carte créée, points, niveau, statut).
create or replace function public._loyalty_enqueue(p_user uuid, p_kind text, p_points integer default 0,
  p_reference text default null, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
begin
  select * into v_acc from public.loyalty_accounts where user_id = p_user;
  if v_acc.card_number is null then return; end if;
  insert into public.loyalty_sync_queue (user_id, card_number, kind, points, tier, card_status, reference, details)
  values (p_user, v_acc.card_number, p_kind, coalesce(p_points, 0), v_acc.tier, v_acc.card_status, p_reference,
          coalesce(p_details, '{}'::jsonb));
end $$;

-- Émet la carte (numéro = téléphone du compte). Renvoie false si le téléphone manque
-- ou si ce numéro est déjà la carte d'un autre compte.
create or replace function public._issue_loyalty_card(p_user uuid, p_tier text, p_source text,
  p_order uuid default null, p_notify boolean default true)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
  v_prof public.profiles;
  v_num text;
begin
  insert into public.loyalty_accounts (user_id) values (p_user) on conflict do nothing;
  select * into v_acc from public.loyalty_accounts where user_id = p_user for update;
  if v_acc.card_status <> 'none' then return true; end if;
  select * into v_prof from public.profiles where id = p_user;
  v_num := public.km_card_number(v_prof.phone);
  if v_num is null then
    perform public._loyalty_event(p_user, 'enroll_blocked', jsonb_build_object('reason', 'PHONE_REQUIRED', 'order_id', p_order));
    return false;
  end if;
  if exists (select 1 from public.loyalty_accounts o where o.card_number = v_num and o.user_id <> p_user) then
    perform public._loyalty_event(p_user, 'enroll_blocked',
      jsonb_build_object('reason', 'CARD_NUMBER_TAKEN', 'card_number', v_num, 'order_id', p_order));
    return false;
  end if;
  update public.loyalty_accounts
     set card_number = v_num, card_status = 'active', card_issued_at = now(), enrollment_source = p_source,
         enrollment_order_id = coalesce(p_order, enrollment_order_id), tier = p_tier,
         tier_changed_at = now(), tier_changed_by = auth.uid(), enroll_eligible_at = null, updated_at = now()
   where user_id = p_user;
  perform public._loyalty_event(p_user, 'issued',
    jsonb_build_object('tier', p_tier, 'source', p_source, 'card_number', v_num, 'order_id', p_order));
  perform public._loyalty_enqueue(p_user, 'enroll', 0, (select o.order_number from public.orders o where o.id = p_order),
    jsonb_build_object('full_name', v_prof.full_name, 'phone', v_prof.phone, 'source', p_source));
  if p_notify then
    insert into public.notifications (user_id, kind, title, body, data)
    values (p_user, 'loyalty', 'Votre carte Kin Marché Fidélité est prête',
            'Carte Membre ' || public._loyalty_tier_label(p_tier) || ' n° ' || v_num
              || '. Présentez-la en magasin et cumulez des points à chaque achat payé.',
            jsonb_build_object('screen', 'loyalty'));
  end if;
  return true;
end $$;

-- Relie le compte au membre Kin Marché Fidélité qui porte le même numéro.
-- Points transférés = solde du programme moins les opérations de l'application déjà
-- reportées dans le programme (évite de compter deux fois les mêmes points).
create or replace function public._link_program_member(p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
  v_prof public.profiles;
  v_num text;
  v_m public.loyalty_program_members;
  v_review boolean := coalesce((public.setting('loyalty')->>'link_review')::boolean, true);
  v_delta integer;
  v_new_balance integer;
  v_tier text;
begin
  select * into v_acc from public.loyalty_accounts where user_id = p_user for update;
  if not found or v_acc.link_blocked then return false; end if;
  if v_acc.external_member_id is not null then return true; end if;
  select * into v_prof from public.profiles where id = p_user;
  v_num := coalesce(v_acc.card_number, public.km_card_number(v_prof.phone));
  if v_num is null then return false; end if;
  select * into v_m from public.loyalty_program_members
   where card_number = v_num and linked_user_id is null for update;
  if not found then return false; end if;
  if v_acc.card_number is null
     and exists (select 1 from public.loyalty_accounts o where o.card_number = v_num and o.user_id <> p_user) then
    return false;
  end if;

  v_delta := v_m.points - v_acc.points_pushed_pending;
  v_new_balance := greatest(v_acc.points_balance + v_delta, 0);
  v_tier := case when public._loyalty_tier_rank(v_m.tier) > public._loyalty_tier_rank(v_acc.tier) then v_m.tier else v_acc.tier end;

  update public.loyalty_program_members
     set linked_user_id = p_user, linked_at = now(), points_applied = points, updated_at = now()
   where id = v_m.id;
  update public.loyalty_accounts
     set card_number = v_num,
         card_status = case when card_status = 'none' then 'active' else card_status end,
         card_issued_at = coalesce(card_issued_at, now()),
         enrollment_source = coalesce(enrollment_source, 'program'),
         tier = v_tier,
         tier_changed_at = case when v_tier is distinct from tier then now() else tier_changed_at end,
         external_member_id = v_m.id, external_linked_at = now(),
         link_verified_at = case when v_review then null else now() end, link_verified_by = null,
         points_balance = v_new_balance,
         lifetime_points = lifetime_points + greatest(v_delta, 0),
         locked_points = case when v_review then least(locked_points + greatest(v_delta, 0), v_new_balance)
                              else least(locked_points, v_new_balance) end,
         points_pushed_pending = 0, enroll_eligible_at = null, updated_at = now()
   where user_id = p_user;
  if v_new_balance <> v_acc.points_balance then
    insert into public.loyalty_transactions (user_id, type, points, note, source)
    values (p_user, 'adjust', v_new_balance - v_acc.points_balance, 'Solde Kin Marché Fidélité (magasins)', 'program');
  end if;
  perform public._loyalty_event(p_user, 'linked', jsonb_build_object('card_number', v_num, 'member_id', v_m.id,
    'member_tier', v_m.tier, 'member_points', v_m.points, 'points_added', v_new_balance - v_acc.points_balance,
    'review', v_review));
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user, 'loyalty', 'Carte Kin Marché Fidélité reliée',
          'Votre carte n° ' || v_num || ' est reliée à votre compte'
            || case when v_m.points > 0 then ' : ' || v_m.points || ' points retrouvés.' else '.' end,
          jsonb_build_object('screen', 'loyalty'));
  return true;
end $$;

-- Cherche le compte d'un membre importé : même numéro de carte, sinon même téléphone.
create or replace function public._try_link_member(p_member uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_m public.loyalty_program_members;
  v_user uuid;
begin
  select * into v_m from public.loyalty_program_members where id = p_member;
  if not found or v_m.linked_user_id is not null then return false; end if;
  select la.user_id into v_user from public.loyalty_accounts la
   where la.card_number = v_m.card_number and la.external_member_id is null and not la.link_blocked;
  if v_user is null then
    select p.id into v_user from public.profiles p
      join public.loyalty_accounts la on la.user_id = p.id
     where public.km_card_number(p.phone) = v_m.card_number
       and la.card_number is null and la.external_member_id is null and not la.link_blocked
     order by p.created_at limit 1;
  end if;
  if v_user is null then return false; end if;
  return public._link_program_member(v_user);
end $$;

-- Nouvel export du programme pour un membre déjà connu : applique l'activité en magasin
-- depuis le dernier import (achats, points utilisés, changement de niveau).
create or replace function public._apply_member_snapshot(p_member uuid, p_points integer, p_tier text, p_name text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_m public.loyalty_program_members;
  v_acc public.loyalty_accounts;
  v_delta integer;
  v_new_balance integer;
  v_tier_changed boolean;
begin
  select * into v_m from public.loyalty_program_members where id = p_member for update;
  if not found then return 0; end if;
  update public.loyalty_program_members
     set points = p_points, tier = p_tier, full_name = coalesce(p_name, full_name), imported_at = now(), updated_at = now()
   where id = p_member;
  if v_m.linked_user_id is null then
    perform public._try_link_member(p_member);
    return 0;
  end if;

  select * into v_acc from public.loyalty_accounts where user_id = v_m.linked_user_id for update;
  v_delta := p_points - v_m.points_applied - v_acc.points_pushed_pending;
  v_new_balance := greatest(v_acc.points_balance + v_delta, 0);
  v_tier_changed := p_tier is distinct from v_m.tier and v_acc.card_status <> 'none';
  update public.loyalty_accounts
     set points_balance = v_new_balance,
         lifetime_points = lifetime_points + greatest(v_delta, 0),
         locked_points = case when link_verified_at is null then least(greatest(locked_points + v_delta, 0), v_new_balance)
                              else least(locked_points, v_new_balance) end,
         points_pushed_pending = 0,
         tier = case when v_tier_changed then p_tier else tier end,
         tier_changed_at = case when v_tier_changed then now() else tier_changed_at end,
         updated_at = now()
   where user_id = v_m.linked_user_id;
  update public.loyalty_program_members set points_applied = p_points where id = p_member;
  if v_new_balance <> v_acc.points_balance then
    insert into public.loyalty_transactions (user_id, type, points, note, source)
    values (v_m.linked_user_id, 'adjust', v_new_balance - v_acc.points_balance, 'Mise à jour Kin Marché Fidélité (magasins)', 'program');
  end if;
  if v_tier_changed then
    perform public._loyalty_event(v_m.linked_user_id, 'tier_changed',
      jsonb_build_object('from', v_acc.tier, 'to', p_tier, 'source', 'program'));
  end if;
  return v_new_balance - v_acc.points_balance;
end $$;

-- Points d'une commande payée. Sans carte : la carte Argent est émise si le montant
-- payé atteint le seuil d'adhésion (16 000 FC par défaut), sinon aucun point.
create or replace function public._award_loyalty(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_rules jsonb := coalesce(public.setting('loyalty'), '{}'::jsonb);
  v_acc public.loyalty_accounts;
  v_rate numeric;
  v_min_cdf numeric := coalesce((v_rules->>'enroll_min_cdf')::numeric, 16000);
  v_bonus numeric;
  v_points integer;
  v_new_card boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.customer_id is null or v_order.payment_status <> 'succeeded'
     or v_order.status in ('cancelled', 'refunded') then
    return;
  end if;
  if exists (select 1 from public.loyalty_transactions where order_id = p_order_id and type = 'earn') then return; end if;

  insert into public.loyalty_accounts (user_id) values (v_order.customer_id) on conflict do nothing;
  select * into v_acc from public.loyalty_accounts where user_id = v_order.customer_id for update;

  if v_acc.card_status = 'none' then
    perform public._link_program_member(v_order.customer_id);
    select * into v_acc from public.loyalty_accounts where user_id = v_order.customer_id for update;
  end if;

  if v_acc.card_status = 'none' then
    v_rate := case when v_order.display_currency = 'CDF' and v_order.exchange_rate > 1 then v_order.exchange_rate
                   else (select r.rate_per_usd from public.exchange_rates r where r.currency = 'CDF') end;
    if v_rate is null or round(v_order.total_usd * v_rate) < v_min_cdf then
      return;
    end if;
    if not public._issue_loyalty_card(v_order.customer_id, 'silver', 'purchase', p_order_id, false) then
      -- Achat qualifiant mais pas de téléphone valide : la carte sera émise dès qu'il sera ajouté.
      update public.loyalty_accounts
         set enroll_eligible_at = coalesce(enroll_eligible_at, now()),
             enrollment_order_id = coalesce(enrollment_order_id, p_order_id), updated_at = now()
       where user_id = v_order.customer_id;
      insert into public.notifications (user_id, kind, title, body, data)
      values (v_order.customer_id, 'loyalty', 'Votre carte Kin Marché Fidélité vous attend',
              'Ajoutez votre numéro de téléphone dans votre profil : il devient votre numéro de carte.',
              jsonb_build_object('screen', 'loyalty'));
      return;
    end if;
    v_new_card := true;
    select * into v_acc from public.loyalty_accounts where user_id = v_order.customer_id;
  end if;

  if v_acc.card_status <> 'active' then return; end if;

  v_bonus := coalesce((v_rules->'tier_bonus'->>v_acc.tier)::numeric,
                      case v_acc.tier when 'gold' then 0.10 when 'platinum' then 0.25 else 0 end);
  v_points := floor(floor(v_order.total_usd * coalesce((v_rules->>'earn_per_usd')::numeric, 1)) * (1 + v_bonus))::integer;

  if v_points > 0 then
    insert into public.loyalty_transactions (user_id, order_id, type, points, expires_at, note)
    values (v_order.customer_id, p_order_id, 'earn', v_points,
            now() + make_interval(days => coalesce((v_rules->>'expiry_days')::integer, 365)),
            'Commande ' || v_order.order_number
              || case when v_bonus > 0 then ' (bonus ' || public._loyalty_tier_label(v_acc.tier) || ' +' || round(v_bonus * 100) || ' %)' else '' end);
    update public.loyalty_accounts
       set points_balance = points_balance + v_points, lifetime_points = lifetime_points + v_points, updated_at = now()
     where user_id = v_order.customer_id;
  end if;

  if v_new_card then
    insert into public.notifications (user_id, kind, title, body, data)
    values (v_order.customer_id, 'loyalty', 'Bienvenue chez Kin Marché Fidélité',
            'Votre carte Membre Argent n° ' || v_acc.card_number || ' est active'
              || case when v_points > 0 then ' : +' || v_points || ' points sur la commande ' || v_order.order_number || '.' else '.' end,
            jsonb_build_object('screen', 'loyalty', 'order_id', p_order_id));
  elsif v_points > 0 then
    insert into public.notifications (user_id, kind, title, body, data)
    values (v_order.customer_id, 'loyalty', 'Points fidélité crédités',
            '+' || v_points || ' points sur la commande ' || v_order.order_number || '.',
            jsonb_build_object('screen', 'loyalty', 'order_id', p_order_id));
  end if;
end $$;

-- Commande annulée ou remboursée après paiement : points gagnés retirés,
-- points utilisés restitués.
create or replace function public._reverse_loyalty(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_acc public.loyalty_accounts;
  v_earned integer;
  v_take integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.customer_id is null then return; end if;
  select * into v_acc from public.loyalty_accounts where user_id = v_order.customer_id for update;
  if not found then return; end if;

  select coalesce(sum(points), 0) into v_earned from public.loyalty_transactions
   where order_id = p_order_id and type = 'earn';
  if v_earned > 0 and not exists (select 1 from public.loyalty_transactions
                                   where order_id = p_order_id and type = 'refund_reversal') then
    v_take := least(v_acc.points_balance, v_earned);
    update public.loyalty_accounts
       set points_balance = points_balance - v_take,
           lifetime_points = greatest(lifetime_points - v_earned, 0),
           locked_points = least(locked_points, points_balance - v_take),
           updated_at = now()
     where user_id = v_order.customer_id;
    insert into public.loyalty_transactions (user_id, order_id, type, points, note)
    values (v_order.customer_id, p_order_id, 'refund_reversal', -v_take,
            'Commande ' || v_order.order_number || case when v_order.status = 'refunded' or v_order.payment_status = 'refunded'
                                                       then ' remboursée' else ' annulée' end);
  end if;

  if v_order.loyalty_points_used > 0 and v_order.paid_at is not null
     and not exists (select 1 from public.loyalty_transactions
                      where order_id = p_order_id and type = 'adjust' and points > 0) then
    update public.loyalty_accounts set points_balance = points_balance + v_order.loyalty_points_used, updated_at = now()
     where user_id = v_order.customer_id;
    insert into public.loyalty_transactions (user_id, order_id, type, points, note)
    values (v_order.customer_id, p_order_id, 'adjust', v_order.loyalty_points_used, 'Points restitués');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Déclencheurs
-- ---------------------------------------------------------------------

-- Paiement confirmé -> points ; annulation ou remboursement -> retrait.
create or replace function public.tg_loyalty_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_status = 'succeeded' and old.payment_status is distinct from 'succeeded' then
    perform public._award_loyalty(new.id);
  end if;
  if (new.status in ('cancelled', 'refunded') and old.status is distinct from new.status)
     or (new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded') then
    perform public._reverse_loyalty(new.id);
  end if;
  return null;
end $$;
drop trigger if exists orders_loyalty on public.orders;
create trigger orders_loyalty after update of payment_status, status on public.orders
  for each row execute function public.tg_loyalty_order();

-- Nouveau compte : liaison immédiate si le téléphone est celui d'un membre du programme.
create or replace function public.tg_loyalty_account_new()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public._link_program_member(new.user_id);
  return null;
end $$;
drop trigger if exists loyalty_accounts_link on public.loyalty_accounts;
create trigger loyalty_accounts_link after insert on public.loyalty_accounts
  for each row execute function public.tg_loyalty_account_new();

-- Téléphone ajouté ou modifié : liaison, ou carte Argent pour un client déjà qualifié.
create or replace function public.tg_loyalty_profile_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
begin
  if new.phone is not distinct from old.phone then return null; end if;
  select * into v_acc from public.loyalty_accounts where user_id = new.id;
  if not found or v_acc.card_status <> 'none' then return null; end if;
  if public._link_program_member(new.id) then return null; end if;
  if v_acc.enroll_eligible_at is not null then
    if public._issue_loyalty_card(new.id, 'silver', 'purchase', v_acc.enrollment_order_id, true) then
      if v_acc.enrollment_order_id is not null then
        perform public._award_loyalty(v_acc.enrollment_order_id);
      end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists profiles_loyalty_phone on public.profiles;
create trigger profiles_loyalty_phone after update of phone on public.profiles
  for each row execute function public.tg_loyalty_profile_phone();

-- Membre importé : liaison avec le compte qui porte son numéro.
create or replace function public.tg_loyalty_member_new()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public._try_link_member(new.id);
  return null;
end $$;
drop trigger if exists loyalty_members_link on public.loyalty_program_members;
create trigger loyalty_members_link after insert on public.loyalty_program_members
  for each row execute function public.tg_loyalty_member_new();

-- Tout mouvement de points fait dans l'application est mis dans la file d'export
-- (sauf les soldes venus du programme lui-même).
create or replace function public.tg_loyalty_tx_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'program' or new.points = 0 then return null; end if;
  perform public._loyalty_enqueue(new.user_id, 'points', new.points,
    coalesce((select o.order_number from public.orders o where o.id = new.order_id), new.note),
    jsonb_build_object('type', new.type, 'note', new.note, 'transaction_id', new.id));
  return null;
end $$;
drop trigger if exists loyalty_tx_sync on public.loyalty_transactions;
create trigger loyalty_tx_sync after insert on public.loyalty_transactions
  for each row execute function public.tg_loyalty_tx_sync();

-- ---------------------------------------------------------------------
-- 6. Client
-- ---------------------------------------------------------------------

create or replace function public.get_my_loyalty_card()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_acc public.loyalty_accounts;
  v_prof public.profiles;
  v_rules jsonb := coalesce(public.setting('loyalty'), '{}'::jsonb);
  v_rate numeric;
  v_min_cdf numeric;
  v_phone_card text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_acc from public.loyalty_accounts where user_id = v_uid;
  select * into v_prof from public.profiles where id = v_uid;
  select r.rate_per_usd into v_rate from public.exchange_rates r where r.currency = 'CDF';
  v_min_cdf := coalesce((v_rules->>'enroll_min_cdf')::numeric, 16000);
  v_phone_card := public.km_card_number(v_prof.phone);
  return jsonb_build_object(
    'card_number', v_acc.card_number,
    'card_status', coalesce(v_acc.card_status, 'none'),
    'tier', coalesce(v_acc.tier, 'none'),
    'points_balance', coalesce(v_acc.points_balance, 0),
    'locked_points', coalesce(v_acc.locked_points, 0),
    'redeemable_points', case when v_acc.card_status = 'active' then greatest(v_acc.points_balance - v_acc.locked_points, 0) else 0 end,
    'lifetime_points', coalesce(v_acc.lifetime_points, 0),
    'card_issued_at', v_acc.card_issued_at,
    'tier_changed_at', v_acc.tier_changed_at,
    'enrollment_source', v_acc.enrollment_source,
    'full_name', v_prof.full_name,
    'phone', v_prof.phone,
    'phone_card_number', v_phone_card,
    'phone_card_taken', v_acc.card_number is null and v_phone_card is not null
      and exists (select 1 from public.loyalty_accounts o where o.card_number = v_phone_card and o.user_id <> v_uid),
    'linked', v_acc.external_member_id is not null,
    'link_verified', v_acc.link_verified_at is not null,
    'enroll_eligible', v_acc.enroll_eligible_at is not null,
    'enroll_min_cdf', v_min_cdf,
    'enroll_min_usd', case when v_rate > 0 then round(v_min_cdf / v_rate, 2) end,
    'earn_per_usd', coalesce((v_rules->>'earn_per_usd')::numeric, 1),
    'point_value_usd', coalesce((v_rules->>'point_value_usd')::numeric, 0.01),
    'tier_bonus', coalesce(v_rules->'tier_bonus', '{"silver": 0, "gold": 0.1, "platinum": 0.25}'::jsonb),
    'program', coalesce(v_rules->'program',
      jsonb_build_object('name', 'Kin Marché Fidélité', 'url', 'https://loyalty.kinmarche.com/login')));
end $$;

-- « Je suis déjà membre » : nouvelle recherche de la carte avec le téléphone du compte.
create or replace function public.link_my_loyalty_card()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_acc public.loyalty_accounts;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  insert into public.loyalty_accounts (user_id) values (v_uid) on conflict do nothing;
  select * into v_acc from public.loyalty_accounts where user_id = v_uid;
  if v_acc.external_member_id is null then
    if not public._link_program_member(v_uid) then
      -- Client déjà qualifié (achat payé de 16 000 FC) qui vient d'ajouter un téléphone valide.
      if v_acc.card_status = 'none' and v_acc.enroll_eligible_at is not null then
        if public._issue_loyalty_card(v_uid, 'silver', 'purchase', v_acc.enrollment_order_id, true) then
          if v_acc.enrollment_order_id is not null then
            perform public._award_loyalty(v_acc.enrollment_order_id);
          end if;
        end if;
      end if;
    end if;
  end if;
  select * into v_acc from public.loyalty_accounts where user_id = v_uid;
  return public.get_my_loyalty_card() || jsonb_build_object('found', v_acc.external_member_id is not null);
end $$;

-- ---------------------------------------------------------------------
-- 7. Administration (administrateur général et administrateurs de supermarché)
-- ---------------------------------------------------------------------

create or replace function public.admin_loyalty_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_super boolean := public.is_super_admin();
  v jsonb;
begin
  if not public.can_manage_loyalty() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select jsonb_build_object(
    'members', count(*) filter (where card_status <> 'none'),
    'active', count(*) filter (where card_status = 'active'),
    'suspended', count(*) filter (where card_status = 'suspended'),
    'silver', count(*) filter (where card_status <> 'none' and tier = 'silver'),
    'gold', count(*) filter (where card_status <> 'none' and tier = 'gold'),
    'platinum', count(*) filter (where card_status <> 'none' and tier = 'platinum'),
    'points_outstanding', coalesce(sum(points_balance) filter (where card_status <> 'none'), 0),
    'points_locked', coalesce(sum(locked_points), 0),
    'linked', count(*) filter (where external_member_id is not null),
    'links_to_verify', count(*) filter (where external_member_id is not null and link_verified_at is null),
    'eligible_without_card', count(*) filter (where card_status = 'none' and enroll_eligible_at is not null),
    'issued_30d', count(*) filter (where card_issued_at >= now() - interval '30 days'))
  into v from public.loyalty_accounts;
  return v || jsonb_build_object(
    'points_earned_30d', (select coalesce(sum(points), 0) from public.loyalty_transactions
                           where type = 'earn' and created_at >= now() - interval '30 days'),
    'program_members', (select count(*) from public.loyalty_program_members),
    'program_members_unlinked', (select count(*) from public.loyalty_program_members where linked_user_id is null),
    'last_import_at', (select max(imported_at) from public.loyalty_program_members),
    'sync_pending', case when v_super then (select count(*) from public.loyalty_sync_queue where status = 'pending') end,
    'settings', coalesce(public.setting('loyalty'), '{}'::jsonb),
    'can_admin', v_super);
end $$;

create or replace function public.admin_loyalty_cards(p_search text default null, p_tier text default null,
  p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_super boolean := public.is_super_admin();
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_num text := public.km_card_number(p_search);
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_total integer;
  v_rows jsonb;
begin
  if not public.can_manage_loyalty() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce(max(r.total), 0), coalesce(jsonb_agg(to_jsonb(r) - 'total' order by r.updated_at desc), '[]'::jsonb)
    into v_total, v_rows
  from (
    select la.user_id, p.full_name, p.phone, case when v_super then p.email end as email,
           la.card_number, la.card_status, la.tier, la.points_balance, la.locked_points, la.lifetime_points,
           la.card_issued_at, la.enrollment_source, la.external_member_id is not null as linked,
           la.link_verified_at is not null as link_verified, la.enroll_eligible_at, la.updated_at,
           count(*) over () as total
    from public.loyalty_accounts la
    join public.profiles p on p.id = la.user_id
    where (p_tier is null or la.tier = p_tier)
      and case
            when p_status is null then la.card_status <> 'none' or v_q is not null
            when p_status = 'to_verify' then la.external_member_id is not null and la.link_verified_at is null
            when p_status = 'eligible' then la.card_status = 'none' and la.enroll_eligible_at is not null
            else la.card_status = p_status end
      and (v_q is null
           or (v_num is not null and (la.card_number = v_num or public.km_card_number(p.phone) = v_num))
           or (v_digits is not null and length(v_digits) >= 4
               and (la.card_number like '%' || v_digits || '%'
                    or regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%'))
           or p.full_name ilike '%' || v_q || '%'
           or (v_super and p.email ilike '%' || v_q || '%'))
    order by la.updated_at desc
    limit v_limit offset greatest(coalesce(p_offset, 0), 0)
  ) r;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.admin_loyalty_card_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_super boolean := public.is_super_admin();
  v_acc public.loyalty_accounts;
  v_prof public.profiles;
begin
  if not public.can_manage_loyalty() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_prof from public.profiles where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select * into v_acc from public.loyalty_accounts where user_id = p_user;
  return jsonb_build_object(
    'account', to_jsonb(v_acc),
    'profile', jsonb_build_object('full_name', v_prof.full_name, 'phone', v_prof.phone,
      'email', case when v_super then v_prof.email end, 'created_at', v_prof.created_at,
      'role', v_prof.role, 'is_active', v_prof.is_active,
      'phone_card_number', public.km_card_number(v_prof.phone)),
    'member', (select jsonb_build_object('card_number', m.card_number, 'full_name', m.full_name, 'tier', m.tier,
                 'points', m.points, 'imported_at', m.imported_at, 'linked_at', m.linked_at)
               from public.loyalty_program_members m where m.id = v_acc.external_member_id),
    'orders', (select jsonb_build_object('paid', count(*), 'total_usd', coalesce(sum(o.total_usd), 0), 'last_paid_at', max(o.paid_at))
               from public.orders o where o.customer_id = p_user and o.payment_status = 'succeeded'),
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'type', t.type, 'points', t.points, 'note', t.note,
                       'source', t.source, 'created_at', t.created_at, 'order_number', o.order_number) order by t.created_at desc), '[]'::jsonb)
                     from (select * from public.loyalty_transactions where user_id = p_user order by created_at desc limit 50) t
                     left join public.orders o on o.id = t.order_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'details', e.details, 'created_at', e.created_at,
                 'actor', a.full_name) order by e.created_at desc), '[]'::jsonb)
               from (select * from public.loyalty_card_events where user_id = p_user order by created_at desc limit 50) e
               left join public.profiles a on a.id = e.actor_id),
    'can_admin', v_super);
end $$;

-- Niveau de la carte (émet la carte si le client n'en a pas encore).
create or replace function public.admin_set_loyalty_tier(p_user uuid, p_tier text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
  v_num text;
  v_old text;
  v_bonus numeric;
begin
  if not public.can_manage_loyalty() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_tier is null or p_tier not in ('silver', 'gold', 'platinum') then raise exception 'INVALID_TIER'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
  insert into public.loyalty_accounts (user_id) values (p_user) on conflict do nothing;
  select * into v_acc from public.loyalty_accounts where user_id = p_user for update;

  if v_acc.card_status = 'none' then
    v_num := public.km_card_number((select phone from public.profiles where id = p_user));
    if v_num is null then raise exception 'PHONE_REQUIRED'; end if;
    if exists (select 1 from public.loyalty_accounts o where o.card_number = v_num and o.user_id <> p_user) then
      raise exception 'CARD_NUMBER_TAKEN';
    end if;
    perform public._issue_loyalty_card(p_user, p_tier, 'admin', null, true);
    perform public.write_audit('loyalty_card_issued', 'loyalty_accounts', p_user::text,
      jsonb_build_object('tier', p_tier, 'card_number', v_num, 'note', p_note));
    return jsonb_build_object('ok', true, 'issued', true, 'tier', p_tier, 'card_number', v_num);
  end if;

  v_old := v_acc.tier;
  if v_old = p_tier then return jsonb_build_object('ok', true, 'tier', p_tier, 'unchanged', true); end if;
  update public.loyalty_accounts
     set tier = p_tier, tier_changed_at = now(), tier_changed_by = auth.uid(), updated_at = now()
   where user_id = p_user;
  perform public._loyalty_event(p_user, 'tier_changed', jsonb_build_object('from', v_old, 'to', p_tier, 'note', p_note));
  perform public._loyalty_enqueue(p_user, 'tier', 0, null, jsonb_build_object('from', v_old, 'to', p_tier, 'note', p_note));
  v_bonus := coalesce((public.setting('loyalty')->'tier_bonus'->>p_tier)::numeric, 0);
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user, 'loyalty',
          case when public._loyalty_tier_rank(p_tier) > public._loyalty_tier_rank(v_old)
               then 'Félicitations : carte ' || public._loyalty_tier_label(p_tier)
               else 'Votre carte fidélité a changé de niveau' end,
          'Votre carte Kin Marché Fidélité est maintenant ' || public._loyalty_tier_label(p_tier)
            || case when v_bonus > 0 then ' : +' || round(v_bonus * 100) || ' % de points bonus sur vos achats.' else '.' end,
          jsonb_build_object('screen', 'loyalty'));
  perform public.write_audit('loyalty_tier_changed', 'loyalty_accounts', p_user::text,
    jsonb_build_object('from', v_old, 'to', p_tier, 'note', p_note));
  return jsonb_build_object('ok', true, 'tier', p_tier, 'from', v_old);
end $$;

create or replace function public.admin_set_loyalty_card_status(p_user uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
begin
  if not public.can_manage_loyalty() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('active', 'suspended') then raise exception 'INVALID_STATUS'; end if;
  select * into v_acc from public.loyalty_accounts where user_id = p_user for update;
  if not found or v_acc.card_status = 'none' then raise exception 'NO_CARD'; end if;
  if v_acc.card_status = p_status then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  update public.loyalty_accounts set card_status = p_status, updated_at = now() where user_id = p_user;
  perform public._loyalty_event(p_user, case when p_status = 'suspended' then 'suspended' else 'reactivated' end,
    jsonb_build_object('note', p_note));
  perform public._loyalty_enqueue(p_user, 'status', 0, null, jsonb_build_object('note', p_note));
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user, 'loyalty',
          case when p_status = 'suspended' then 'Carte fidélité suspendue' else 'Carte fidélité réactivée' end,
          case when p_status = 'suspended'
               then 'Votre carte Kin Marché Fidélité est suspendue. Contactez le service client pour en savoir plus.'
               else 'Votre carte Kin Marché Fidélité est de nouveau active.' end,
          jsonb_build_object('screen', 'loyalty'));
  perform public.write_audit('loyalty_card_status', 'loyalty_accounts', p_user::text,
    jsonb_build_object('from', v_acc.card_status, 'to', p_status, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

create or replace function public.admin_adjust_loyalty_points(p_user uuid, p_points integer, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
begin
  if not public.can_manage_loyalty() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_points is null or p_points = 0 or abs(p_points) > 1000000 then raise exception 'INVALID_POINTS'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_acc from public.loyalty_accounts where user_id = p_user for update;
  if not found or v_acc.card_status = 'none' then raise exception 'NO_CARD'; end if;
  if v_acc.points_balance + p_points < 0 then raise exception 'INSUFFICIENT_POINTS'; end if;
  update public.loyalty_accounts
     set points_balance = points_balance + p_points,
         lifetime_points = lifetime_points + greatest(p_points, 0),
         locked_points = least(locked_points, points_balance + p_points),
         updated_at = now()
   where user_id = p_user;
  insert into public.loyalty_transactions (user_id, type, points, note)
  values (p_user, 'adjust', p_points, 'Ajustement : ' || trim(p_note));
  perform public._loyalty_event(p_user, 'points_adjusted', jsonb_build_object('points', p_points, 'note', trim(p_note)));
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user, 'loyalty', 'Solde de points mis à jour',
          case when p_points > 0 then '+' else '' end || p_points || ' points : ' || trim(p_note),
          jsonb_build_object('screen', 'loyalty'));
  perform public.write_audit('loyalty_points_adjusted', 'loyalty_accounts', p_user::text,
    jsonb_build_object('points', p_points, 'note', trim(p_note)));
  return jsonb_build_object('ok', true, 'points_balance', v_acc.points_balance + p_points);
end $$;

-- Liaison avec un membre importé : vérifier (débloque les points), délier, relier.
create or replace function public.admin_loyalty_link(p_user uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.loyalty_accounts;
  v_remove integer;
  v_from_program boolean;
  v_linked boolean;
begin
  if not public.can_manage_loyalty() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_acc from public.loyalty_accounts where user_id = p_user for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  if p_action = 'verify' then
    if v_acc.external_member_id is null then raise exception 'NOT_LINKED'; end if;
    update public.loyalty_accounts
       set link_verified_at = now(), link_verified_by = auth.uid(), locked_points = 0, updated_at = now()
     where user_id = p_user;
    perform public._loyalty_event(p_user, 'link_verified', jsonb_build_object('unlocked_points', v_acc.locked_points));
    perform public.write_audit('loyalty_link_verified', 'loyalty_accounts', p_user::text,
      jsonb_build_object('unlocked_points', v_acc.locked_points));
    return jsonb_build_object('ok', true, 'unlocked_points', v_acc.locked_points);

  elsif p_action = 'unlink' then
    if v_acc.external_member_id is null then raise exception 'NOT_LINKED'; end if;
    -- Points venus du programme depuis la liaison : ils appartiennent à la carte en magasin.
    select least(greatest(coalesce(sum(t.points), 0), 0), v_acc.points_balance)::integer into v_remove
      from public.loyalty_transactions t
     where t.user_id = p_user and t.source = 'program' and t.created_at >= v_acc.external_linked_at;
    v_from_program := v_acc.enrollment_source = 'program';
    update public.loyalty_program_members
       set linked_user_id = null, linked_at = null, points_applied = 0, updated_at = now()
     where id = v_acc.external_member_id;
    -- Carte venue uniquement du programme : retirée pour que son vrai titulaire puisse la relier.
    update public.loyalty_accounts
       set external_member_id = null, external_linked_at = null, link_verified_at = null, link_verified_by = null,
           points_balance = points_balance - v_remove, locked_points = 0, link_blocked = true,
           card_number = case when v_from_program then null else card_number end,
           card_status = case when v_from_program then 'none' else card_status end,
           tier = case when v_from_program then 'none' else tier end,
           card_issued_at = case when v_from_program then null else card_issued_at end,
           enrollment_source = case when v_from_program then null else enrollment_source end,
           updated_at = now()
     where user_id = p_user;
    if v_remove > 0 then
      insert into public.loyalty_transactions (user_id, type, points, note, source)
      values (p_user, 'adjust', -v_remove, 'Carte Kin Marché Fidélité déliée', 'program');
    end if;
    perform public._loyalty_event(p_user, 'unlinked', jsonb_build_object('removed_points', v_remove, 'card_withdrawn', v_from_program));
    perform public.write_audit('loyalty_unlinked', 'loyalty_accounts', p_user::text,
      jsonb_build_object('removed_points', v_remove, 'card_withdrawn', v_from_program));
    return jsonb_build_object('ok', true, 'removed_points', v_remove, 'card_withdrawn', v_from_program);

  elsif p_action = 'relink' then
    update public.loyalty_accounts set link_blocked = false, updated_at = now() where user_id = p_user;
    v_linked := public._link_program_member(p_user);
    perform public.write_audit('loyalty_relink', 'loyalty_accounts', p_user::text, jsonb_build_object('linked', v_linked));
    return jsonb_build_object('ok', true, 'linked', v_linked);
  end if;
  raise exception 'INVALID_ACTION';
end $$;

-- Import de l'export des membres Kin Marché Fidélité (administrateur général).
-- Chaque ligne : card_number ou phone, full_name, tier, points.
create or replace function public.admin_import_loyalty_members(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_idx integer := 0;
  v_num text;
  v_digits text;
  v_points integer;
  v_name text;
  v_member uuid;
  v_seen text[] := '{}';
  v_inserted integer := 0;
  v_updated integer := 0;
  v_delta integer := 0;
  v_linked_before integer;
  v_linked_after integer;
  v_invalid jsonb := '[]'::jsonb;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_ROWS'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'TOO_MANY_ROWS'; end if;
  select count(*) into v_linked_before from public.loyalty_program_members where linked_user_id is not null;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_row) <> 'object' then
      v_invalid := v_invalid || jsonb_build_object('row', v_idx, 'reason', 'FORMAT'); continue;
    end if;
    v_num := public.km_card_number(coalesce(nullif(v_row->>'card_number', ''), v_row->>'phone'));
    if v_num is null then
      v_invalid := v_invalid || jsonb_build_object('row', v_idx, 'reason', 'CARD_NUMBER'); continue;
    end if;
    if v_num = any(v_seen) then
      v_invalid := v_invalid || jsonb_build_object('row', v_idx, 'reason', 'DUPLICATE', 'card_number', v_num); continue;
    end if;
    v_seen := v_seen || v_num;
    v_digits := regexp_replace(coalesce(v_row->>'points', '0'), '[^0-9]', '', 'g');
    if length(v_digits) > 9 then
      v_invalid := v_invalid || jsonb_build_object('row', v_idx, 'reason', 'POINTS', 'card_number', v_num); continue;
    end if;
    v_points := coalesce(nullif(v_digits, '')::integer, 0);
    v_name := nullif(trim(coalesce(v_row->>'full_name', v_row->>'name', '')), '');

    select id into v_member from public.loyalty_program_members where card_number = v_num;
    if found then
      v_delta := v_delta + public._apply_member_snapshot(v_member, v_points,
                                                         public._loyalty_tier_from_text(v_row->>'tier'), v_name);
      v_updated := v_updated + 1;
    else
      insert into public.loyalty_program_members (card_number, full_name, tier, points, external_ref, imported_by)
      values (v_num, v_name, public._loyalty_tier_from_text(v_row->>'tier'), v_points,
              nullif(trim(coalesce(v_row->>'external_ref', '')), ''), auth.uid());
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  select count(*) into v_linked_after from public.loyalty_program_members where linked_user_id is not null;
  perform public.write_audit('loyalty_members_import', 'loyalty_program_members', null,
    jsonb_build_object('rows', v_idx, 'inserted', v_inserted, 'updated', v_updated,
                       'invalid', jsonb_array_length(v_invalid), 'linked', v_linked_after - v_linked_before));
  return jsonb_build_object('ok', true, 'rows', v_idx, 'inserted', v_inserted, 'updated', v_updated,
    'linked', v_linked_after - v_linked_before, 'points_delta', v_delta, 'invalid', v_invalid);
end $$;

create or replace function public.admin_update_loyalty_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := coalesce(public.setting('loyalty'), '{}'::jsonb);
  v numeric;
  k text;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_SETTINGS'; end if;

  if p_settings ? 'earn_per_usd' then
    v := (p_settings->>'earn_per_usd')::numeric;
    if v < 0 or v > 1000 then raise exception 'INVALID_SETTING' using detail = 'earn_per_usd'; end if;
    v_new := jsonb_set(v_new, '{earn_per_usd}', to_jsonb(v));
  end if;
  if p_settings ? 'enroll_min_cdf' then
    v := (p_settings->>'enroll_min_cdf')::numeric;
    if v < 0 or v > 100000000 then raise exception 'INVALID_SETTING' using detail = 'enroll_min_cdf'; end if;
    v_new := jsonb_set(v_new, '{enroll_min_cdf}', to_jsonb(round(v)));
  end if;
  if p_settings ? 'point_value_usd' then
    v := (p_settings->>'point_value_usd')::numeric;
    if v < 0 or v > 10 then raise exception 'INVALID_SETTING' using detail = 'point_value_usd'; end if;
    v_new := jsonb_set(v_new, '{point_value_usd}', to_jsonb(v));
  end if;
  if p_settings ? 'max_redeem_ratio' then
    v := (p_settings->>'max_redeem_ratio')::numeric;
    if v < 0 or v > 1 then raise exception 'INVALID_SETTING' using detail = 'max_redeem_ratio'; end if;
    v_new := jsonb_set(v_new, '{max_redeem_ratio}', to_jsonb(v));
  end if;
  if p_settings ? 'expiry_days' then
    v := (p_settings->>'expiry_days')::numeric;
    if v < 1 or v > 3650 then raise exception 'INVALID_SETTING' using detail = 'expiry_days'; end if;
    v_new := jsonb_set(v_new, '{expiry_days}', to_jsonb(round(v)::integer));
  end if;
  if p_settings ? 'link_review' then
    if jsonb_typeof(p_settings->'link_review') <> 'boolean' then raise exception 'INVALID_SETTING' using detail = 'link_review'; end if;
    v_new := jsonb_set(v_new, '{link_review}', p_settings->'link_review');
  end if;
  if p_settings ? 'tier_bonus' then
    foreach k in array array['silver', 'gold', 'platinum'] loop
      if p_settings->'tier_bonus' ? k then
        v := (p_settings->'tier_bonus'->>k)::numeric;
        if v < 0 or v > 5 then raise exception 'INVALID_SETTING' using detail = 'tier_bonus.' || k; end if;
        v_new := jsonb_set(v_new, array['tier_bonus', k], to_jsonb(v), true);
      end if;
    end loop;
  end if;
  if p_settings ? 'program' then
    if p_settings->'program' ? 'name' then
      if length(coalesce(p_settings->'program'->>'name', '')) not between 1 and 80 then
        raise exception 'INVALID_SETTING' using detail = 'program.name';
      end if;
      v_new := jsonb_set(v_new, '{program,name}', to_jsonb(trim(p_settings->'program'->>'name')), true);
    end if;
    if p_settings->'program' ? 'url' then
      if coalesce(p_settings->'program'->>'url', '') !~ '^https://[^\s]+$' then
        raise exception 'INVALID_SETTING' using detail = 'program.url';
      end if;
      v_new := jsonb_set(v_new, '{program,url}', to_jsonb(p_settings->'program'->>'url'), true);
    end if;
    if p_settings->'program' ? 'phone' then
      if length(coalesce(p_settings->'program'->>'phone', '')) > 30 then
        raise exception 'INVALID_SETTING' using detail = 'program.phone';
      end if;
      v_new := jsonb_set(v_new, '{program,phone}', to_jsonb(trim(coalesce(p_settings->'program'->>'phone', ''))), true);
    end if;
  end if;

  update public.app_settings set value = v_new, updated_at = now(), updated_by = auth.uid() where key = 'loyalty';
  perform public.write_audit('loyalty_settings', 'app_settings', 'loyalty', p_settings);
  return v_new;
end $$;

-- File des opérations à reporter dans l'espace Kin Marché Fidélité (administrateur général).
create or replace function public.admin_loyalty_sync_queue(p_status text default 'pending', p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
               from (select status, count(*) as n from public.loyalty_sync_queue group by status) s),
    'rows', (select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb) from (
               select q.id, q.created_at, q.kind, q.card_number, p.full_name, q.points, q.tier, q.card_status,
                      q.reference, q.details, q.status, q.processed_at
               from public.loyalty_sync_queue q left join public.profiles p on p.id = q.user_id
               where p_status is null or q.status = p_status
               order by q.id
               limit least(greatest(coalesce(p_limit, 500), 1), 2000)) q));
end $$;

create or replace function public.admin_mark_loyalty_sync(p_ids bigint[], p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.loyalty_sync_queue;
  n integer := 0;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('sent', 'skipped', 'pending') then raise exception 'INVALID_STATUS'; end if;
  for r in select * from public.loyalty_sync_queue where id = any(coalesce(p_ids, '{}')) order by id for update loop
    if r.status = p_status then continue; end if;
    -- Points saisis dans le programme : déduits du prochain import pour ne pas les compter deux fois.
    if r.kind = 'points' and r.user_id is not null then
      if p_status = 'sent' then
        update public.loyalty_accounts set points_pushed_pending = points_pushed_pending + r.points where user_id = r.user_id;
      elsif r.status = 'sent' then
        update public.loyalty_accounts set points_pushed_pending = points_pushed_pending - r.points where user_id = r.user_id;
      end if;
    end if;
    update public.loyalty_sync_queue
       set status = p_status,
           processed_at = case when p_status = 'pending' then null else now() end,
           processed_by = case when p_status = 'pending' then null else auth.uid() end,
           attempts = attempts + case when p_status = 'sent' then 1 else 0 end
     where id = r.id;
    n := n + 1;
  end loop;
  perform public.write_audit('loyalty_sync_marked', 'loyalty_sync_queue', null,
    jsonb_build_object('status', p_status, 'count', n));
  return jsonb_build_object('ok', true, 'updated', n);
end $$;

-- ---------------------------------------------------------------------
-- 8. Réglages du programme
-- ---------------------------------------------------------------------

insert into public.app_settings (key, value) values ('loyalty', '{}'::jsonb) on conflict (key) do nothing;
update public.app_settings
   set value = jsonb_build_object(
         'earn_per_usd', 1,
         'expiry_days', 365,
         'point_value_usd', 0.01,
         'max_redeem_ratio', 0.5,
         'enroll_min_cdf', 16000,
         'tier_bonus', jsonb_build_object('silver', 0, 'gold', 0.10, 'platinum', 0.25),
         'link_review', true,
         'program', jsonb_build_object('name', 'Kin Marché Fidélité', 'url', 'https://loyalty.kinmarche.com/login',
                                       'phone', '+243891441111', 'website', 'https://www.kinmarche.com'))
       || (value - 'tiers'),
       updated_at = now()
 where key = 'loyalty';

-- ---------------------------------------------------------------------
-- 9. Fonctions existantes : seules les cartes actives utilisent leurs points ;
--    le suivi indique si le livreur est certifié.
-- ---------------------------------------------------------------------

do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public._order_quote(uuid,uuid,text,integer)'::regprocedure);
  if position('greatest(points_balance - locked_points, 0)' in d) = 0 then
    n := replace(d,
      'select points_balance into v_balance from public.loyalty_accounts where user_id = p_user;',
      'select case when card_status = ''active'' then greatest(points_balance - locked_points, 0) else 0 end into v_balance from public.loyalty_accounts where user_id = p_user;');
    if n = d then raise exception '_order_quote : extrait à remplacer introuvable'; end if;
    execute n;
  end if;

  d := pg_get_functiondef('public.get_order_tracking(uuid)'::regprocedure);
  if position('''verified'', d.status' in d) = 0 then
    n := replace(d,
      '''rating'', d.rating, ''location_shared'', d.location_shared)',
      '''rating'', d.rating, ''location_shared'', d.location_shared, ''verified'', d.status = ''verified'', ''verified_at'', d.verified_at)');
    if n = d then raise exception 'get_order_tracking : extrait à remplacer introuvable'; end if;
    execute n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. Droits d'exécution
-- ---------------------------------------------------------------------

revoke execute on function public.km_card_number(text) from public, anon;
revoke execute on function public._loyalty_tier_rank(text) from public, anon, authenticated;
revoke execute on function public._loyalty_tier_label(text) from public, anon, authenticated;
revoke execute on function public._loyalty_tier_from_text(text) from public, anon, authenticated;
revoke execute on function public._loyalty_event(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public._loyalty_enqueue(uuid, text, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public._issue_loyalty_card(uuid, text, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._link_program_member(uuid) from public, anon, authenticated;
revoke execute on function public._try_link_member(uuid) from public, anon, authenticated;
revoke execute on function public._apply_member_snapshot(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public._award_loyalty(uuid) from public, anon, authenticated;
revoke execute on function public._reverse_loyalty(uuid) from public, anon, authenticated;
revoke execute on function public.tg_loyalty_order() from public, anon, authenticated;
revoke execute on function public.tg_loyalty_account_new() from public, anon, authenticated;
revoke execute on function public.tg_loyalty_profile_phone() from public, anon, authenticated;
revoke execute on function public.tg_loyalty_member_new() from public, anon, authenticated;
revoke execute on function public.tg_loyalty_tx_sync() from public, anon, authenticated;
revoke execute on function public.can_manage_loyalty() from public, anon;
revoke execute on function public.get_my_loyalty_card() from public, anon;
revoke execute on function public.link_my_loyalty_card() from public, anon;
revoke execute on function public.admin_loyalty_overview() from public, anon;
revoke execute on function public.admin_loyalty_cards(text, text, text, integer, integer) from public, anon;
revoke execute on function public.admin_loyalty_card_detail(uuid) from public, anon;
revoke execute on function public.admin_set_loyalty_tier(uuid, text, text) from public, anon;
revoke execute on function public.admin_set_loyalty_card_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_adjust_loyalty_points(uuid, integer, text) from public, anon;
revoke execute on function public.admin_loyalty_link(uuid, text) from public, anon;
revoke execute on function public.admin_import_loyalty_members(jsonb) from public, anon;
revoke execute on function public.admin_update_loyalty_settings(jsonb) from public, anon;
revoke execute on function public.admin_loyalty_sync_queue(text, integer) from public, anon;
revoke execute on function public.admin_mark_loyalty_sync(bigint[], text) from public, anon;
grant execute on function public.km_card_number(text) to authenticated;
grant execute on function public.can_manage_loyalty() to authenticated;
grant execute on function public.get_my_loyalty_card() to authenticated;
grant execute on function public.link_my_loyalty_card() to authenticated;
grant execute on function public.admin_loyalty_overview() to authenticated;
grant execute on function public.admin_loyalty_cards(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_loyalty_card_detail(uuid) to authenticated;
grant execute on function public.admin_set_loyalty_tier(uuid, text, text) to authenticated;
grant execute on function public.admin_set_loyalty_card_status(uuid, text, text) to authenticated;
grant execute on function public.admin_adjust_loyalty_points(uuid, integer, text) to authenticated;
grant execute on function public.admin_loyalty_link(uuid, text) to authenticated;
grant execute on function public.admin_import_loyalty_members(jsonb) to authenticated;
grant execute on function public.admin_update_loyalty_settings(jsonb) to authenticated;
grant execute on function public.admin_loyalty_sync_queue(text, integer) to authenticated;
grant execute on function public.admin_mark_loyalty_sync(bigint[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Comptes existants
-- ---------------------------------------------------------------------

-- Clients qui avaient déjà cumulé des points : carte Argent ; puis liaison éventuelle.
do $$
declare
  r record;
begin
  for r in select user_id from public.loyalty_accounts where card_status = 'none' and lifetime_points > 0 loop
    perform public._issue_loyalty_card(r.user_id, 'silver', 'purchase', null, false);
  end loop;
  for r in select user_id from public.loyalty_accounts where external_member_id is null loop
    perform public._link_program_member(r.user_id);
  end loop;
end $$;
