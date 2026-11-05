-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Tableau de bord de la Direction et messagerie.
-- * admin_dashboard : indicateurs agrégés, calculés avec les droits de
--   l'appelant (SECURITY INVOKER : la RLS limite un agent à sa région).
-- * ticket_people : noms des participants des fils que l'appelant peut
--   consulter (jamais le téléphone, l'e-mail ni l'adresse).
-- =====================================================================

create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_paid_idx on public.orders (paid_at desc) where paid_at is not null;

create or replace function public.admin_dashboard(p_month date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tz constant text := 'Africa/Kinshasa';
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_from timestamptz;
  v_prev timestamptz;
  v_month date;
  v_month_end date;
  v_super boolean := public.is_super_admin();
  v_kpi jsonb; v_series jsonb; v_cal jsonb; v_top_stores jsonb; v_top_products jsonb;
  v_counts jsonb; v_recent jsonb; v_map jsonb; v_zones jsonb;
begin
  if not (v_super or public.is_agent()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_from := (v_today - 29)::timestamp at time zone v_tz;
  v_prev := (v_today - 59)::timestamp at time zone v_tz;
  v_month := date_trunc('month', coalesce(p_month, v_today))::date;
  v_month_end := (v_month + interval '1 month')::date;

  -- Indicateurs des 30 derniers jours (et des 30 jours précédents pour la tendance).
  select jsonb_build_object(
    'sales_usd', coalesce(sum(total_usd) filter (where paid_at >= v_from and payment_status in ('succeeded', 'partially_refunded')), 0),
    'sales_prev_usd', coalesce(sum(total_usd) filter (where paid_at >= v_prev and paid_at < v_from and payment_status in ('succeeded', 'partially_refunded')), 0),
    'paid', count(*) filter (where paid_at >= v_from and payment_status in ('succeeded', 'partially_refunded')),
    'paid_prev', count(*) filter (where paid_at >= v_prev and paid_at < v_from and payment_status in ('succeeded', 'partially_refunded')),
    'orders', count(*) filter (where created_at >= v_from),
    'orders_prev', count(*) filter (where created_at >= v_prev and created_at < v_from),
    'orders_paid', count(*) filter (where created_at >= v_from and paid_at is not null),
    'delivered', count(*) filter (where created_at >= v_from and status in ('delivered', 'completed')),
    'in_progress', count(*) filter (where created_at >= v_from and status not in ('received', 'delivered', 'completed', 'cancelled', 'failed', 'refunded')),
    'awaiting_payment', count(*) filter (where created_at >= v_from and status = 'received'),
    'cancelled', count(*) filter (where created_at >= v_from and status in ('cancelled', 'failed', 'refunded'))
  ) into v_kpi
  from public.orders
  where created_at >= v_prev or paid_at >= v_prev;

  -- Courbe journalière : commandes passées et ventes confirmées.
  with days as (select v_today - 29 + i as d from generate_series(0, 29) as g(i)),
  oc as (select (created_at at time zone v_tz)::date as d, count(*) as n
         from public.orders where created_at >= v_from group by 1),
  ps as (select (paid_at at time zone v_tz)::date as d, sum(total_usd) as s, count(*) as n
         from public.orders where paid_at >= v_from and payment_status in ('succeeded', 'partially_refunded') group by 1)
  select jsonb_agg(jsonb_build_object('d', days.d, 'orders', coalesce(oc.n, 0), 'sales', coalesce(ps.s, 0), 'paid', coalesce(ps.n, 0)) order by days.d)
  into v_series
  from days left join oc using (d) left join ps using (d);

  -- Calendrier du mois demandé.
  with days as (select v_month + i as d from generate_series(0, (v_month_end - v_month) - 1) as g(i)),
  oc as (select (created_at at time zone v_tz)::date as d, count(*) as n,
                count(*) filter (where status in ('delivered', 'completed')) as dl
         from public.orders
         where created_at >= (v_month::timestamp at time zone v_tz) and created_at < (v_month_end::timestamp at time zone v_tz)
         group by 1)
  select jsonb_build_object('month', v_month, 'days',
           jsonb_agg(jsonb_build_object('d', days.d, 'n', coalesce(oc.n, 0), 'delivered', coalesce(oc.dl, 0)) order by days.d))
  into v_cal
  from days left join oc using (d);

  select coalesce(jsonb_agg(x order by x.sales desc), '[]'::jsonb) into v_top_stores from (
    select s.id, s.name, s.commune, sum(o.total_usd) as sales, count(*) as orders
    from public.orders o join public.stores s on s.id = o.store_id
    where o.paid_at >= v_from and o.payment_status in ('succeeded', 'partially_refunded')
    group by s.id, s.name, s.commune order by sales desc limit 6) x;

  select coalesce(jsonb_agg(x order by x.sales desc), '[]'::jsonb) into v_top_products from (
    select i.product_id, max(i.product_name) as name, max(i.unit::text) as unit, sum(i.quantity) as qty, sum(i.line_total_usd) as sales
    from public.order_items i join public.orders o on o.id = i.order_id
    where o.paid_at >= v_from and o.payment_status in ('succeeded', 'partially_refunded') and not i.missing
    group by i.product_id order by sales desc limit 6) x;

  select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) into v_zones from (
    select coalesce(nullif(trim(delivery_address->>'commune'), ''), 'Non précisée') as commune, count(*) as n
    from public.orders where created_at >= v_from group by 1 order by n desc limit 6) x;

  select jsonb_build_object(
    'stores_active', (select count(*) from public.stores s where s.is_active and (v_super or public.agent_sees_store(s.id))),
    'stores_open', (select count(*) from public.stores s where s.is_active and s.is_open and (v_super or public.agent_sees_store(s.id))),
    'stores_unverified', (select count(*) from public.stores s where s.is_active and not s.address_verified and (v_super or public.agent_sees_store(s.id))),
    'stores_no_gps', (select count(*) from public.stores s where s.is_active and (s.latitude is null or s.longitude is null) and (v_super or public.agent_sees_store(s.id))),
    'drivers_verified', (select count(*) from public.drivers where status = 'verified'),
    'drivers_online', (select count(*) from public.drivers where status = 'verified' and is_available),
    'drivers_pending', (select count(*) from public.drivers where status = 'pending_review'),
    'customers', (select count(*) from public.profiles where role = 'customer'),
    'customers_new', (select count(*) from public.profiles where role = 'customer' and created_at >= v_from),
    'products', (select count(*) from public.products where is_active),
    'proofs_pending', (select count(*) from public.payment_proofs where status = 'pending'),
    'tickets_open', (select count(*) from public.support_tickets where status in ('open', 'pending')),
    'low_stock', (select count(*) from public.store_inventory si where si.is_available and si.stock <= coalesce(si.low_stock_threshold, 0)
                    and (v_super or public.agent_sees_store(si.store_id)))
  ) into v_counts;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_recent from (
    select o.id, o.order_number, o.status, o.payment_status, o.total_usd, o.created_at, s.name as store
    from public.orders o left join public.stores s on s.id = o.store_id
    order by o.created_at desc limit 8) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'lat', s.latitude, 'lng', s.longitude,
           'commune', s.commune, 'open', s.is_open, 'verified', s.address_verified) order by s.name), '[]'::jsonb)
  into v_map
  from public.stores s
  where s.is_active and s.latitude is not null and s.longitude is not null and (v_super or public.agent_sees_store(s.id));

  return jsonb_build_object('today', v_today, 'from', v_today - 29, 'kpi', v_kpi, 'series', coalesce(v_series, '[]'::jsonb),
    'calendar', v_cal, 'top_stores', v_top_stores, 'top_products', v_top_products, 'zones', v_zones,
    'counts', v_counts, 'recent', v_recent, 'map', v_map);
end $$;
revoke execute on function public.admin_dashboard(date) from public, anon;
grant execute on function public.admin_dashboard(date) to authenticated;

create or replace function public.ticket_people(p_ticket_ids uuid[])
returns table (ticket_id uuid, user_id uuid, full_name text, is_customer boolean)
language sql stable security definer set search_path = '' as $$
  select x.ticket_id, p.id, p.full_name, bool_or(x.is_customer)
  from (
    select t.id as ticket_id, t.customer_id as user_id, true as is_customer
      from public.support_tickets t
      where t.id = any (p_ticket_ids[1:300]) and public.can_view_ticket(t.id)
    union all
    select distinct m.ticket_id, m.sender_id, false
      from public.messages m
      where m.ticket_id = any (p_ticket_ids[1:300]) and public.can_view_ticket(m.ticket_id)
  ) x
  join public.profiles p on p.id = x.user_id
  group by x.ticket_id, p.id, p.full_name
$$;
revoke execute on function public.ticket_people(uuid[]) from public, anon;
grant execute on function public.ticket_people(uuid[]) to authenticated;
