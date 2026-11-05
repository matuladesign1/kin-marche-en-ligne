-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Secrets serveur, notifications push, ETA, tâches planifiées
-- =====================================================================

-- Schéma non exposé par l'API : lisible uniquement par le rôle service (Edge Functions).
-- La clé Google (GOOGLE_MAPS_API_KEY) y est insérée À LA MAIN dans le SQL Editor, jamais dans Git :
--   insert into km_private.secrets (name, value) values ('GOOGLE_MAPS_API_KEY', '…');
create schema if not exists km_private;
revoke all on schema km_private from public, anon, authenticated;
grant usage on schema km_private to service_role;
create table if not exists km_private.secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table km_private.secrets enable row level security;
revoke all on km_private.secrets from public, anon, authenticated;
grant select on km_private.secrets to service_role;

create or replace function public.get_server_secret(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select value from km_private.secrets where name = p_name
$$;
revoke execute on function public.get_server_secret(text) from public, anon, authenticated;
grant execute on function public.get_server_secret(text) to service_role;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

insert into km_private.secrets (name, value)
values ('PUSH_WEBHOOK_SECRET', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- Chaque notification enregistrée déclenche l'envoi push (asynchrone).
create or replace function public.tg_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.push_tokens where user_id = new.user_id) then
    perform net.http_post(
      url := 'https://trobgcehelmxkvqjtdbo.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-push-secret', (select value from km_private.secrets where name = 'PUSH_WEBHOOK_SECRET')),
      body := jsonb_build_object('notification_id', new.id)
    );
  end if;
  return new;
end $$;
revoke execute on function public.tg_notification_push() from public, anon, authenticated;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.tg_notification_push();

alter table public.delivery_assignments
  add column if not exists eta_updated_at timestamptz,
  add column if not exists route_distance_km numeric(8,2),
  add column if not exists eta_target text;

select cron.schedule('km-expire-unpaid', '*/5 * * * *', 'select public.expire_unpaid_orders()');
select cron.schedule('km-expire-offers', '* * * * *', 'select public.expire_stale_offers()');

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
   where order_id = p_order_id and status in ('accepted','completed') order by offered_at desc limit 1;

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
        'route_distance_km', v_a.route_distance_km, 'eta_updated_at', v_a.eta_updated_at, 'eta_target', v_a.eta_target) end,
    'driver', v_driver,
    'position', v_pos,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('status', h.status, 'at', h.created_at, 'note', h.note) order by h.created_at), '[]'::jsonb)
                from public.order_status_history h where h.order_id = p_order_id));
end $$;
revoke execute on function public.get_order_tracking(uuid) from public, anon;
