-- =====================================================================
-- Campagnes promotionnelles (administrateur général)
-- Un message de promotion part sur trois canaux au choix :
--   • Application : notification dans « Messages » (grande photo) + push sur le téléphone (photo en grand) ;
--   • WhatsApp : modèle de message Meta (photo + titre + texte) sur le numéro du client ;
--   • E-mail : courriel avec la photo, le titre, le texte et le bouton de l'offre.
-- Seuls les clients actifs qui n'ont pas coupé les « Promotions » dans l'application sont joints.
-- =====================================================================

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 500),
  image_url text check (image_url is null or image_url ~ '^https://'),
  link_type text check (link_type is null or link_type in ('product', 'category', 'promotion', 'url')),
  link_value text check (link_value is null or char_length(link_value) <= 500),
  audience text not null default 'all' check (audience in ('all', 'buyers', 'new', 'lapsed', 'city')),
  audience_value text check (audience_value is null or char_length(audience_value) <= 120),
  channels text[] not null default array['app']::text[]
    check (cardinality(channels) between 1 and 3 and channels <@ array['app', 'whatsapp', 'email']::text[]),
  status text not null default 'draft' check (status in ('draft', 'sent')),
  -- Résultat par canal : {"app": {"sent": 120, "at": …}, "whatsapp": {"sent": 80, "failed": 3, "error": …}, "email": {…}}
  stats jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_created_idx on public.campaigns (created_at desc);
drop trigger if exists campaigns_updated on public.campaigns;
create trigger campaigns_updated before update on public.campaigns
  for each row execute function public.tg_set_updated_at();

alter table public.campaigns enable row level security;
drop policy if exists "campagnes : administrateur général" on public.campaigns;
create policy "campagnes : administrateur général" on public.campaigns for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- Statistiques rapides (notifications d'une campagne, vues ou non).
create index if not exists notifications_campaign_idx on public.notifications ((data ->> 'campaign_id')) where kind = 'promo';

-- ---------------------------------------------------------------------
-- Destinataires d'une campagne : clients actifs, promotions non coupées, selon le public choisi.
-- p_only : un seul compte (envoi de test à l'administrateur lui-même, sans filtre).
-- Réservée au serveur (fonction « campaign-send ») et aux fonctions ci-dessous.
-- ---------------------------------------------------------------------
create or replace function public.campaign_recipients(p_campaign uuid, p_only uuid default null)
returns table (user_id uuid, full_name text, email text, phone text, language text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.phone, p.language::text
  from public.campaigns c
  join public.profiles p on p.is_active
  where c.id = p_campaign
    and case
      when p_only is not null then p.id = p_only
      else p.role = 'customer'
        and coalesce(p.notification_prefs -> 'promos', 'true'::jsonb) <> 'false'::jsonb
        and case c.audience
          when 'all' then true
          when 'buyers' then exists (select 1 from public.orders o where o.customer_id = p.id)
          when 'new' then not exists (select 1 from public.orders o where o.customer_id = p.id)
          when 'lapsed' then exists (select 1 from public.orders o where o.customer_id = p.id)
            and not exists (select 1 from public.orders o where o.customer_id = p.id and o.created_at > now() - interval '30 days')
          when 'city' then exists (select 1 from public.addresses a where a.user_id = p.id
            and public.km_norm(a.city) = public.km_norm(c.audience_value))
          else false
        end
    end
$$;
revoke execute on function public.campaign_recipients(uuid, uuid) from public, anon, authenticated;
grant execute on function public.campaign_recipients(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- Canal « Application » : une notification « promo » par client (grande photo dans Messages).
-- Le déclencheur des notifications l'envoie aussi en push sur les téléphones joignables.
-- p_test : envoi à soi-même seulement, sans toucher aux statistiques.
-- ---------------------------------------------------------------------
create or replace function public.campaign_send_app(p_campaign uuid, p_test boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v public.campaigns;
  v_n integer := 0;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v from public.campaigns where id = p_campaign for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not p_test and v.stats ? 'app' then raise exception 'ALREADY_SENT' using errcode = '23505'; end if;

  insert into public.notifications (user_id, kind, title, body, data)
  select r.user_id, 'promo', v.title, v.body,
         jsonb_strip_nulls(jsonb_build_object(
           'campaign_id', v.id::text, 'image_url', v.image_url, 'link_type', v.link_type, 'link_value', v.link_value,
           'test', case when p_test then true end))
  from public.campaign_recipients(v.id, case when p_test then auth.uid() end) r;
  get diagnostics v_n = row_count;

  if not p_test then
    update public.campaigns
       set stats = stats || jsonb_build_object('app', jsonb_build_object('sent', v_n, 'at', now())),
           status = 'sent', sent_at = coalesce(sent_at, now())
     where id = v.id;
  end if;
  return v_n;
end $$;
revoke execute on function public.campaign_send_app(uuid, boolean) from public, anon;
grant execute on function public.campaign_send_app(uuid, boolean) to authenticated;

-- Retire une campagne des « Messages » de tous les clients (offre terminée, erreur…).
create or replace function public.campaign_withdraw(p_campaign uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.notifications where kind = 'promo' and data ->> 'campaign_id' = p_campaign::text;
  get diagnostics v_n = row_count;
  update public.campaigns set stats = stats || jsonb_build_object('withdrawn_at', now()) where id = p_campaign;
  return v_n;
end $$;
revoke execute on function public.campaign_withdraw(uuid) from public, anon;
grant execute on function public.campaign_withdraw(uuid) to authenticated;

-- Reçues et vues dans l'application, par campagne (hors envois de test).
create or replace function public.campaign_stats()
returns table (campaign_id text, delivered integer, seen integer)
language sql stable security definer set search_path = '' as $$
  select n.data ->> 'campaign_id', count(*)::integer, count(n.read_at)::integer
  from public.notifications n
  where n.kind = 'promo' and n.data ? 'campaign_id' and not n.data ? 'test' and public.is_super_admin()
  group by 1
$$;
revoke execute on function public.campaign_stats() from public, anon;
grant execute on function public.campaign_stats() to authenticated;

-- Taille de chaque public (clients joignables, avec un numéro, avec un e-mail) et principales villes.
create or replace function public.campaign_audiences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_seg jsonb;
  v_cities jsonb;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with c as (
    select p.id,
           regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') ~ '^\d{9,15}$' as has_phone,
           coalesce(p.email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' as has_email,
           exists (select 1 from public.orders o where o.customer_id = p.id) as bought,
           exists (select 1 from public.orders o where o.customer_id = p.id and o.created_at > now() - interval '30 days') as recent
    from public.profiles p
    where p.is_active and p.role = 'customer'
      and coalesce(p.notification_prefs -> 'promos', 'true'::jsonb) <> 'false'::jsonb
  ), seg as (
    select 'all' as k, c.* from c
    union all select 'buyers', c.* from c where c.bought
    union all select 'new', c.* from c where not c.bought
    union all select 'lapsed', c.* from c where c.bought and not c.recent
  )
  select coalesce(jsonb_object_agg(k, jsonb_build_object('customers', n, 'phone', ph, 'email', em)), '{}'::jsonb)
    into v_seg
    from (select k, count(*)::integer n, count(*) filter (where has_phone)::integer ph,
                 count(*) filter (where has_email)::integer em
          from seg group by k) s;

  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'customers', n) order by n desc, city), '[]'::jsonb)
    into v_cities
    from (select min(trim(a.city)) as city, count(distinct a.user_id)::integer as n
          from public.addresses a
          join public.profiles p on p.id = a.user_id and p.is_active and p.role = 'customer'
            and coalesce(p.notification_prefs -> 'promos', 'true'::jsonb) <> 'false'::jsonb
          where nullif(trim(a.city), '') is not null
          group by public.km_norm(a.city)
          order by 2 desc limit 30) x;

  return jsonb_build_object('segments', v_seg, 'cities', v_cities);
end $$;
revoke execute on function public.campaign_audiences() from public, anon;
grant execute on function public.campaign_audiences() to authenticated;

-- ---------------------------------------------------------------------
-- Réglages des canaux WhatsApp et e-mail : clés enregistrées dans le coffre privé du serveur.
-- L'administrateur général peut les remplacer ou les effacer, jamais les relire.
-- ---------------------------------------------------------------------
create or replace function public.set_channel_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name not in ('RESEND_API_KEY', 'EMAIL_FROM', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
                    'WHATSAPP_TEMPLATE', 'WHATSAPP_TEMPLATE_LANG') then
    raise exception 'SECRET_NOT_ALLOWED' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_value, '')), '') is null then
    delete from km_private.secrets where name = p_name;
  else
    insert into km_private.secrets (name, value, updated_at) values (p_name, trim(p_value), now())
    on conflict (name) do update set value = excluded.value, updated_at = now();
  end if;
end $$;
revoke execute on function public.set_channel_secret(text, text) from public, anon;
grant execute on function public.set_channel_secret(text, text) to authenticated;

-- État des canaux (configuré ou non) sans jamais révéler les clés ; l'expéditeur et le modèle ne sont pas secrets.
create or replace function public.campaign_channels()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'email', (select count(*) = 2 from km_private.secrets where name in ('RESEND_API_KEY', 'EMAIL_FROM')),
    'whatsapp', (select count(*) = 3 from km_private.secrets where name in ('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE')),
    'email_from', (select value from km_private.secrets where name = 'EMAIL_FROM'),
    'whatsapp_template', (select value from km_private.secrets where name = 'WHATSAPP_TEMPLATE'),
    'whatsapp_lang', coalesce((select value from km_private.secrets where name = 'WHATSAPP_TEMPLATE_LANG'), 'fr'),
    'whatsapp_phone_id', (select value from km_private.secrets where name = 'WHATSAPP_PHONE_NUMBER_ID'),
    'push_devices', (select count(distinct user_id) from public.push_tokens)
  );
end $$;
revoke execute on function public.campaign_channels() from public, anon;
grant execute on function public.campaign_channels() to authenticated;
