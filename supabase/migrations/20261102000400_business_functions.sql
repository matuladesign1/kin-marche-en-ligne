-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Logique métier côté serveur
-- Panier, devis, commande, paiement (confirmation serveur), statuts,
-- affectation des livreurs, OTP de livraison, fidélité.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vue catalogue (respecte la RLS de l'appelant)
-- ---------------------------------------------------------------------
create or replace view public.catalog_items with (security_invoker = true) as
select
  i.id                       as inventory_id,
  i.store_id,
  s.name                     as store_name,
  s.commune                  as store_commune,
  p.id                       as product_id,
  p.sku,
  p.barcode,
  p.name,
  p.name_i18n,
  p.brand,
  p.unit,
  p.unit_size,
  p.min_quantity,
  p.quantity_step,
  p.category_id,
  p.is_featured,
  p.is_local,
  p.rating,
  p.rating_count,
  i.price_usd,
  public.effective_price(i)  as effective_price_usd,
  (public.effective_price(i) < i.price_usd) as on_promo,
  i.stock,
  (i.is_available and i.stock > 0 and i.stock >= p.min_quantity) as in_stock,
  i.sold_count,
  p.created_at,
  (select pi.url from public.product_images pi where pi.product_id = p.id order by pi.sort_order, pi.created_at limit 1) as image_url,
  p.search_text
from public.store_inventory i
join public.products p on p.id = i.product_id
join public.stores s on s.id = i.store_id
where p.is_active and s.is_active;

-- Recherche texte / marque / code-barres, avec repli « contient »
create or replace function public.search_catalog(
  p_query text default null,
  p_category_id uuid default null,
  p_store_id uuid default null,
  p_in_stock_only boolean default false,
  p_limit integer default 40,
  p_offset integer default 0)
returns setof public.catalog_items
language sql stable security invoker set search_path = '' as $$
  select c.* from public.catalog_items c
  where (p_category_id is null or c.category_id = p_category_id
         or c.category_id in (select id from public.product_categories where parent_id = p_category_id))
    and (p_store_id is null or c.store_id = p_store_id)
    and (not p_in_stock_only or c.in_stock)
    and (
      p_query is null or length(trim(p_query)) = 0
      or c.search_text @@ websearch_to_tsquery('simple', p_query)
      or c.name ilike '%' || p_query || '%'
      or c.brand ilike '%' || p_query || '%'
      or c.barcode = trim(p_query)
      or c.sku = trim(p_query)
    )
  order by
    case when p_query is not null and c.barcode = trim(p_query) then 0 else 1 end,
    c.in_stock desc,
    case when p_query is not null and length(trim(p_query)) > 0
         then ts_rank(c.search_text, websearch_to_tsquery('simple', p_query)) else 0 end desc,
    c.sold_count desc,
    c.name
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------
-- Recommandation de magasin : celui qui PEUT servir, pas juste le plus proche
-- ---------------------------------------------------------------------
create or replace function public.recommend_stores(
  p_lat double precision default null,
  p_lng double precision default null,
  p_commune text default null,
  p_product_ids uuid[] default null)
returns table (
  store_id uuid, name text, commune text, quartier text, address_verified boolean,
  latitude double precision, longitude double precision,
  is_open boolean, distance_km double precision, can_deliver boolean,
  delivery_fee_usd numeric, avg_prep_minutes integer,
  available_count integer, requested_count integer, rating numeric)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select s.*,
      public.distance_km(p_lat, p_lng, s.latitude, s.longitude) as dist
    from public.stores s
    where s.is_active
  )
  select
    b.id, b.name, b.commune, b.quartier, b.address_verified, b.latitude, b.longitude,
    b.is_open,
    round(b.dist::numeric, 2)::double precision,
    b.is_open and (
      (b.dist is not null and b.dist <= b.delivery_radius_km)
      or (b.dist is null and p_commune is not null and b.delivery_zone is not null
          and b.delivery_zone ? p_commune)
    ) as can_deliver,
    round(b.delivery_fee_usd + coalesce(b.dist, 0)::numeric * b.delivery_fee_per_km_usd, 2),
    b.avg_prep_minutes,
    coalesce((select count(*)::int from public.store_inventory i
              join public.products p on p.id = i.product_id
              where i.store_id = b.id and i.is_available and i.stock >= p.min_quantity
                and p.is_active and (p_product_ids is null or i.product_id = any(p_product_ids))), 0),
    coalesce(cardinality(p_product_ids), 0),
    b.rating
  from base b
  order by can_deliver desc, 13 desc, b.dist asc nulls last, b.rating desc
$$;

-- ---------------------------------------------------------------------
-- Paramètres métier
-- ---------------------------------------------------------------------
create or replace function public.setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key
$$;

-- ---------------------------------------------------------------------
-- Panier : ajout (règle : un seul magasin par panier)
-- ---------------------------------------------------------------------
create or replace function public.add_to_cart(p_inventory_id uuid, p_quantity numeric, p_replace_cart boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_inv record;
  v_cart public.carts;
  v_existing numeric := 0;
  v_new_qty numeric;
  v_items integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;

  select i.*, p.min_quantity, p.quantity_step, p.is_active as product_active, s.is_active as store_active
    into v_inv
  from public.store_inventory i
  join public.products p on p.id = i.product_id
  join public.stores s on s.id = i.store_id
  where i.id = p_inventory_id;

  if not found or not v_inv.product_active or not v_inv.store_active then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;
  if not v_inv.is_available or v_inv.stock <= 0 then
    raise exception 'OUT_OF_STOCK';
  end if;

  select * into v_cart from public.carts where user_id = v_uid for update;
  if not found then
    insert into public.carts (user_id) values (v_uid) returning * into v_cart;
  end if;

  select count(*) into v_items from public.cart_items where cart_id = v_cart.id;
  if v_cart.store_id is not null and v_cart.store_id <> v_inv.store_id and v_items > 0 then
    if not p_replace_cart then
      raise exception 'CART_OTHER_STORE' using hint = v_cart.store_id::text;
    end if;
    delete from public.cart_items where cart_id = v_cart.id;
  end if;

  select quantity into v_existing from public.cart_items where cart_id = v_cart.id and inventory_id = p_inventory_id;
  v_new_qty := coalesce(v_existing, 0) + p_quantity;

  if v_new_qty < v_inv.min_quantity then raise exception 'BELOW_MIN_QUANTITY' using hint = v_inv.min_quantity::text; end if;
  if v_new_qty > v_inv.stock then raise exception 'INSUFFICIENT_STOCK' using hint = v_inv.stock::text; end if;

  update public.carts set store_id = v_inv.store_id, updated_at = now() where id = v_cart.id;
  insert into public.cart_items (cart_id, inventory_id, quantity)
  values (v_cart.id, p_inventory_id, v_new_qty)
  on conflict (cart_id, inventory_id) do update set quantity = excluded.quantity;

  return jsonb_build_object('cart_id', v_cart.id, 'store_id', v_inv.store_id, 'quantity', v_new_qty);
end $$;

create or replace function public.set_cart_quantity(p_inventory_id uuid, p_quantity numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_cart_id uuid;
  v_stock numeric; v_min numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select id into v_cart_id from public.carts where user_id = v_uid;
  if p_quantity is null or p_quantity <= 0 then
    delete from public.cart_items where cart_id = v_cart_id and inventory_id = p_inventory_id;
  else
    select i.stock, p.min_quantity into v_stock, v_min
    from public.store_inventory i join public.products p on p.id = i.product_id where i.id = p_inventory_id;
    if p_quantity < v_min then raise exception 'BELOW_MIN_QUANTITY' using hint = v_min::text; end if;
    if p_quantity > v_stock then raise exception 'INSUFFICIENT_STOCK' using hint = v_stock::text; end if;
    update public.cart_items set quantity = p_quantity where cart_id = v_cart_id and inventory_id = p_inventory_id;
  end if;
  if not exists (select 1 from public.cart_items where cart_id = v_cart_id) then
    update public.carts set store_id = null where id = v_cart_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Devis de commande (calcul unique, utilisé par l'écran et par place_order)
-- ---------------------------------------------------------------------
create or replace function public._order_quote(p_user uuid, p_address_id uuid, p_coupon_code text, p_points integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cart public.carts;
  v_store public.stores;
  v_addr public.addresses;
  v_items jsonb := '[]'::jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_dist double precision;
  v_fee numeric := 0;
  v_coupon public.coupons;
  v_coupon_discount numeric := 0;
  v_rules jsonb := coalesce(public.setting('loyalty'), '{}'::jsonb);
  v_point_value numeric := coalesce((v_rules->>'point_value_usd')::numeric, 0.01);
  v_max_ratio numeric := coalesce((v_rules->>'max_redeem_ratio')::numeric, 0.5);
  v_balance integer := 0;
  v_points integer := greatest(coalesce(p_points, 0), 0);
  v_loyalty_discount numeric := 0;
  v_user_uses integer;
  r record;
  v_line numeric;
  v_price numeric;
  v_deliverable boolean := false;
begin
  select * into v_cart from public.carts where user_id = p_user;
  if not found or v_cart.store_id is null then
    return jsonb_build_object('issues', jsonb_build_array('CART_EMPTY'));
  end if;
  select * into v_store from public.stores where id = v_cart.store_id;

  for r in
    select ci.quantity, i.*, p.name as product_name, p.unit, p.min_quantity, p.is_active as product_active,
           i.id as inv_id, p.id as prod_id
    from public.cart_items ci
    join public.store_inventory i on i.id = ci.inventory_id
    join public.products p on p.id = i.product_id
    where ci.cart_id = v_cart.id
  loop
    if r.store_id <> v_cart.store_id then
      v_issues := v_issues || jsonb_build_array('MIXED_STORES');
    end if;
    v_price := public.effective_price(row(r.id, r.store_id, r.product_id, r.price_usd, r.promo_price_usd,
      r.promo_starts_at, r.promo_ends_at, r.stock, r.low_stock_threshold, r.expiry_date, r.is_available,
      r.sold_count, r.updated_at)::public.store_inventory);
    v_line := round(v_price * r.quantity, 2);
    v_subtotal := v_subtotal + v_line;
    if not r.product_active or not r.is_available or r.stock < r.quantity then
      v_issues := v_issues || jsonb_build_array('OUT_OF_STOCK:' || r.product_name);
    end if;
    v_items := v_items || jsonb_build_object(
      'inventory_id', r.inv_id, 'product_id', r.prod_id, 'name', r.product_name, 'unit', r.unit,
      'unit_price_usd', v_price, 'quantity', r.quantity, 'line_total_usd', v_line);
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('issues', jsonb_build_array('CART_EMPTY'));
  end if;

  if not v_store.is_active or not v_store.is_open then
    v_issues := v_issues || jsonb_build_array('STORE_CLOSED');
  end if;
  if v_subtotal < v_store.min_order_usd then
    v_issues := v_issues || jsonb_build_array('BELOW_MIN_ORDER:' || v_store.min_order_usd);
  end if;

  -- Adresse et frais de livraison
  if p_address_id is not null then
    select * into v_addr from public.addresses where id = p_address_id and user_id = p_user;
    if not found then
      v_issues := v_issues || jsonb_build_array('ADDRESS_NOT_FOUND');
    else
      v_dist := public.distance_km(v_addr.latitude, v_addr.longitude, v_store.latitude, v_store.longitude);
      if v_dist is not null then
        v_deliverable := v_dist <= v_store.delivery_radius_km;
      else
        v_deliverable := v_store.delivery_zone is not null and v_store.delivery_zone ? v_addr.commune;
      end if;
      if not v_deliverable then
        v_issues := v_issues || jsonb_build_array(case when v_dist is null then 'ADDRESS_NEEDS_GPS' else 'OUT_OF_DELIVERY_ZONE' end);
      end if;
      v_fee := round(v_store.delivery_fee_usd + coalesce(v_dist, 0)::numeric * v_store.delivery_fee_per_km_usd, 2);
    end if;
  else
    v_issues := v_issues || jsonb_build_array('ADDRESS_REQUIRED');
  end if;

  -- Coupon
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select * into v_coupon from public.coupons where upper(code) = upper(trim(p_coupon_code));
    if not found or not v_coupon.is_active
       or (v_coupon.starts_at is not null and v_coupon.starts_at > now())
       or (v_coupon.ends_at is not null and v_coupon.ends_at < now())
       or (v_coupon.store_id is not null and v_coupon.store_id <> v_cart.store_id)
       or (v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit) then
      v_issues := v_issues || jsonb_build_array('COUPON_INVALID');
      v_coupon := null;
    elsif v_subtotal < v_coupon.min_order_usd then
      v_issues := v_issues || jsonb_build_array('COUPON_MIN_ORDER:' || v_coupon.min_order_usd);
      v_coupon := null;
    else
      select count(*) into v_user_uses from public.orders
      where customer_id = p_user and coupon_id = v_coupon.id and status not in ('cancelled','failed');
      if v_user_uses >= v_coupon.per_user_limit then
        v_issues := v_issues || jsonb_build_array('COUPON_ALREADY_USED');
        v_coupon := null;
      else
        v_coupon_discount := case v_coupon.discount_type
          when 'percent' then round(v_subtotal * v_coupon.discount_value / 100, 2)
          else v_coupon.discount_value end;
        if v_coupon.max_discount_usd is not null then
          v_coupon_discount := least(v_coupon_discount, v_coupon.max_discount_usd);
        end if;
        v_coupon_discount := least(v_coupon_discount, v_subtotal);
      end if;
    end if;
  end if;

  -- Points de fidélité
  select points_balance into v_balance from public.loyalty_accounts where user_id = p_user;
  v_points := least(v_points, coalesce(v_balance, 0));
  v_points := least(v_points, floor(((v_subtotal - v_coupon_discount) * v_max_ratio) / v_point_value)::integer);
  v_points := greatest(v_points, 0);
  v_loyalty_discount := round(v_points * v_point_value, 2);

  return jsonb_build_object(
    'store_id', v_store.id,
    'store_name', v_store.name,
    'items', v_items,
    'subtotal_usd', v_subtotal,
    'distance_km', case when v_dist is null then null else round(v_dist::numeric, 2) end,
    'delivery_fee_usd', v_fee,
    'coupon_id', v_coupon.id,
    'coupon_discount_usd', v_coupon_discount,
    'points_used', v_points,
    'points_balance', coalesce(v_balance, 0),
    'loyalty_discount_usd', v_loyalty_discount,
    'total_usd', greatest(round(v_subtotal + v_fee - v_coupon_discount - v_loyalty_discount, 2), 0),
    'avg_prep_minutes', v_store.avg_prep_minutes,
    'issues', v_issues);
end $$;
revoke execute on function public._order_quote(uuid, uuid, text, integer) from public, anon, authenticated;

create or replace function public.quote_order(p_address_id uuid default null, p_coupon_code text default null, p_points integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return public._order_quote(auth.uid(), p_address_id, p_coupon_code, p_points);
end $$;

-- ---------------------------------------------------------------------
-- Passage de commande : stock réservé, total recalculé côté serveur.
-- La commande reste « en attente de paiement » jusqu'à confirmation
-- réelle du prestataire (confirm_payment, rôle service uniquement).
-- ---------------------------------------------------------------------
create or replace function public.place_order(
  p_address_id uuid,
  p_instructions text default null,
  p_coupon_code text default null,
  p_points integer default 0,
  p_currency public.currency_code default 'USD')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_quote jsonb;
  v_addr public.addresses;
  v_profile public.profiles;
  v_rate numeric := 1;
  v_order_id uuid;
  v_number text;
  v_item jsonb;
  v_updated integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  -- Verrouille le panier pour éviter les doubles commandes
  perform 1 from public.carts where user_id = v_uid for update;

  v_quote := public._order_quote(v_uid, p_address_id, p_coupon_code, p_points);
  if jsonb_array_length(coalesce(v_quote->'issues', '[]'::jsonb)) > 0 then
    raise exception 'ORDER_NOT_POSSIBLE' using detail = (v_quote->'issues')::text;
  end if;

  if p_currency <> 'USD' then
    select rate_per_usd into v_rate from public.exchange_rates where currency = p_currency;
    if v_rate is null then raise exception 'CURRENCY_RATE_MISSING'; end if;
  end if;

  select * into v_addr from public.addresses where id = p_address_id and user_id = v_uid;
  select * into v_profile from public.profiles where id = v_uid;

  v_number := 'KM' || to_char(now() at time zone 'Africa/Kinshasa', 'YYMMDD') || '-' ||
              lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, customer_id, store_id, display_currency, exchange_rate,
    subtotal_usd, delivery_fee_usd, coupon_id, coupon_discount_usd,
    loyalty_points_used, loyalty_discount_usd, total_usd,
    delivery_address, delivery_instructions)
  values (
    v_number, v_uid, (v_quote->>'store_id')::uuid, p_currency, v_rate,
    (v_quote->>'subtotal_usd')::numeric, (v_quote->>'delivery_fee_usd')::numeric,
    nullif(v_quote->>'coupon_id','')::uuid, (v_quote->>'coupon_discount_usd')::numeric,
    (v_quote->>'points_used')::integer, (v_quote->>'loyalty_discount_usd')::numeric,
    (v_quote->>'total_usd')::numeric,
    jsonb_build_object(
      'label', v_addr.label,
      'recipient_name', coalesce(v_addr.recipient_name, v_profile.full_name),
      'recipient_phone', coalesce(v_addr.recipient_phone, v_profile.phone),
      'province', v_addr.province, 'city', v_addr.city, 'commune', v_addr.commune,
      'quartier', v_addr.quartier, 'avenue', v_addr.avenue, 'street_number', v_addr.street_number,
      'landmark', v_addr.landmark, 'latitude', v_addr.latitude, 'longitude', v_addr.longitude,
      'distance_km', v_quote->'distance_km'),
    nullif(trim(p_instructions), ''))
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(v_quote->'items') loop
    -- réservation du stock (échoue si un autre client a été plus rapide)
    update public.store_inventory
       set stock = stock - (v_item->>'quantity')::numeric
     where id = (v_item->>'inventory_id')::uuid and stock >= (v_item->>'quantity')::numeric;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'OUT_OF_STOCK' using detail = v_item->>'name';
    end if;

    insert into public.order_items (order_id, product_id, inventory_id, product_name, unit, unit_price_usd, quantity, line_total_usd)
    values (v_order_id, (v_item->>'product_id')::uuid, (v_item->>'inventory_id')::uuid, v_item->>'name',
            (v_item->>'unit')::public.sale_unit, (v_item->>'unit_price_usd')::numeric,
            (v_item->>'quantity')::numeric, (v_item->>'line_total_usd')::numeric);
  end loop;

  if v_quote->>'coupon_id' is not null then
    update public.coupons set used_count = used_count + 1 where id = (v_quote->>'coupon_id')::uuid;
  end if;

  if (v_quote->>'points_used')::integer > 0 then
    update public.loyalty_accounts set points_balance = points_balance - (v_quote->>'points_used')::integer, updated_at = now()
     where user_id = v_uid;
    insert into public.loyalty_transactions (user_id, order_id, type, points, note)
    values (v_uid, v_order_id, 'redeem', -((v_quote->>'points_used')::integer), 'Utilisés sur la commande ' || v_number);
  end if;

  delete from public.cart_items where cart_id = (select id from public.carts where user_id = v_uid);
  update public.carts set store_id = null, updated_at = now() where user_id = v_uid;

  perform public.write_audit('order_placed', 'orders', v_order_id::text, jsonb_build_object('total_usd', v_quote->'total_usd'));

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_number, 'total_usd', (v_quote->>'total_usd')::numeric);
end $$;

-- Restitution du stock / coupon / points (annulation, échec, expiration)
create or replace function public._release_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  update public.store_inventory i set stock = i.stock + oi.quantity
    from public.order_items oi where oi.order_id = p_order_id and oi.inventory_id = i.id;
  if v_order.coupon_id is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_order.coupon_id;
  end if;
  if v_order.loyalty_points_used > 0 then
    update public.loyalty_accounts set points_balance = points_balance + v_order.loyalty_points_used, updated_at = now()
     where user_id = v_order.customer_id;
    insert into public.loyalty_transactions (user_id, order_id, type, points, note)
    values (v_order.customer_id, p_order_id, 'adjust', v_order.loyalty_points_used, 'Points restitués');
  end if;
end $$;
revoke execute on function public._release_order(uuid) from public, anon, authenticated;

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not (v_order.customer_id = auth.uid() or public.is_super_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- Une commande payée ne s'annule pas ici : elle passe par un remboursement.
  if v_order.status <> 'received' or v_order.payment_status not in ('pending','failed','cancelled') then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;
  if exists (select 1 from public.payments where order_id = p_order_id and status in ('processing','succeeded')) then
    raise exception 'PAYMENT_IN_PROGRESS';
  end if;
  perform public._release_order(p_order_id);
  update public.orders set status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(),
         cancel_reason = nullif(trim(p_reason), '') where id = p_order_id;
  perform public.write_audit('order_cancelled', 'orders', p_order_id::text, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Commandes non payées après le délai configuré : stock libéré (à planifier via pg_cron)
create or replace function public.expire_unpaid_orders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_minutes integer := coalesce((public.setting('orders')->>'unpaid_expiry_minutes')::integer, 30);
  r record; n integer := 0;
begin
  for r in select o.id from public.orders o
           where o.status = 'received' and o.payment_status in ('pending','failed')
             and o.created_at < now() - make_interval(mins => v_minutes)
             and not exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'processing')
           for update skip locked
  loop
    perform public._release_order(r.id);
    update public.orders set status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(),
           cancel_reason = 'Délai de paiement dépassé' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.expire_unpaid_orders() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Fidélité
-- ---------------------------------------------------------------------
create or replace function public._award_loyalty(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_rules jsonb := coalesce(public.setting('loyalty'), '{}'::jsonb);
  v_points integer;
  v_lifetime integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.payment_status <> 'succeeded' then return; end if;
  if exists (select 1 from public.loyalty_transactions where order_id = p_order_id and type = 'earn') then return; end if;
  v_points := floor(v_order.total_usd * coalesce((v_rules->>'earn_per_usd')::numeric, 1))::integer;
  if v_points <= 0 then return; end if;
  insert into public.loyalty_transactions (user_id, order_id, type, points, expires_at, note)
  values (v_order.customer_id, p_order_id, 'earn', v_points,
          now() + make_interval(days => coalesce((v_rules->>'expiry_days')::integer, 365)),
          'Commande ' || v_order.order_number);
  update public.loyalty_accounts
     set points_balance = points_balance + v_points, lifetime_points = lifetime_points + v_points, updated_at = now()
   where user_id = v_order.customer_id
  returning lifetime_points into v_lifetime;
  update public.loyalty_accounts set tier = case
      when v_lifetime >= coalesce((v_rules->'tiers'->>'gold')::integer, 2000) then 'gold'
      when v_lifetime >= coalesce((v_rules->'tiers'->>'silver')::integer, 500) then 'silver'
      else 'bronze' end
   where user_id = v_order.customer_id;
end $$;
revoke execute on function public._award_loyalty(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Paiement : confirmation UNIQUEMENT par le serveur (webhook prestataire)
-- ---------------------------------------------------------------------
create or replace function public.confirm_payment(p_payment_id uuid, p_provider_reference text, p_amount numeric, p_currency public.currency_code, p_raw jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_order public.orders;
  v_rate numeric := 1;
  v_amount_usd numeric;
  v_code text;
  v_commission_rate numeric := coalesce((public.setting('finance')->>'platform_commission_rate')::numeric, 0);
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_pay.status = 'succeeded' then return jsonb_build_object('ok', true, 'already', true); end if;

  if p_currency <> 'USD' then
    select rate_per_usd into v_rate from public.exchange_rates where currency = p_currency;
    if v_rate is null then raise exception 'CURRENCY_RATE_MISSING'; end if;
  end if;
  v_amount_usd := round(p_amount / v_rate, 2);

  select * into v_order from public.orders where id = v_pay.order_id for update;
  if v_order.status = 'cancelled' then
    update public.payments set status = 'succeeded', provider_reference = p_provider_reference, raw_response = p_raw,
           confirmed_at = now(), failure_reason = 'Commande annulée avant confirmation : remboursement requis' where id = p_payment_id;
    insert into public.refunds (payment_id, order_id, amount_usd, reason)
    values (p_payment_id, v_order.id, v_amount_usd, 'Paiement reçu sur commande annulée');
    return jsonb_build_object('ok', false, 'refund_required', true);
  end if;
  if v_amount_usd + 0.01 < v_order.total_usd then
    update public.payments set status = 'failed', failure_reason = 'Montant insuffisant', raw_response = p_raw where id = p_payment_id;
    return jsonb_build_object('ok', false, 'reason', 'AMOUNT_MISMATCH');
  end if;

  update public.payments set status = 'succeeded', provider_reference = p_provider_reference,
         amount_usd = v_amount_usd, raw_response = p_raw, confirmed_at = now()
   where id = p_payment_id;

  update public.orders set payment_status = 'succeeded', paid_at = now(), status = 'payment_confirmed' where id = v_order.id;
  update public.orders set status = 'sent_to_store' where id = v_order.id;

  update public.store_inventory i set sold_count = i.sold_count + ceil(oi.quantity)::int
    from public.order_items oi where oi.order_id = v_order.id and oi.inventory_id = i.id;

  -- OTP de livraison à 6 chiffres, visible uniquement par le client
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.delivery_otps (order_id, code) values (v_order.id, v_code)
  on conflict (order_id) do nothing;

  insert into public.financial_ledger (entry_type, order_id, store_id, amount_usd, description, reference)
  values ('sale', v_order.id, v_order.store_id, v_order.total_usd, 'Paiement commande ' || v_order.order_number, p_provider_reference);
  if v_commission_rate > 0 then
    insert into public.financial_ledger (entry_type, order_id, store_id, amount_usd, description)
    values ('commission', v_order.id, v_order.store_id, round(v_order.subtotal_usd * v_commission_rate, 2), 'Commission plateforme');
  end if;

  insert into public.notifications (user_id, kind, title, body, data)
  select sm.user_id, 'new_order', 'Nouvelle commande payée', 'Commande ' || v_order.order_number,
         jsonb_build_object('order_id', v_order.id)
  from public.store_managers sm where sm.store_id = v_order.store_id;

  return jsonb_build_object('ok', true, 'order_id', v_order.id);
end $$;
revoke execute on function public.confirm_payment(uuid, text, numeric, public.currency_code, jsonb) from public, anon, authenticated;

create or replace function public.fail_payment(p_payment_id uuid, p_reason text, p_raw jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payments set status = 'failed', failure_reason = p_reason, raw_response = p_raw
   where id = p_payment_id and status in ('pending','processing');
  update public.orders o set payment_status = 'failed'
    from public.payments p where p.id = p_payment_id and o.id = p.order_id and o.payment_status = 'pending';
end $$;
revoke execute on function public.fail_payment(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Affectation automatique des livreurs
-- ---------------------------------------------------------------------
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
  if auth.uid() is not null and not (public.is_super_admin() or public.is_order_store_manager(p_order_id)) then
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
    select sm.user_id, 'no_driver', 'Aucun livreur disponible', 'Commande ' || v_order.order_number,
           jsonb_build_object('order_id', p_order_id)
    from public.store_managers sm where sm.store_id = v_order.store_id;
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

create or replace function public.respond_to_offer(p_assignment_id uuid, p_accept boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_a public.delivery_assignments;
begin
  select * into v_a from public.delivery_assignments where id = p_assignment_id for update;
  if not found or v_a.driver_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_a.status <> 'offered' then raise exception 'OFFER_NOT_PENDING'; end if;
  if v_a.expires_at < now() then
    update public.delivery_assignments set status = 'expired', responded_at = now() where id = p_assignment_id;
    perform public.assign_next_driver(v_a.order_id);
    -- pas de raise : il annulerait l'expiration et la réaffectation
    return jsonb_build_object('ok', false, 'reason', 'OFFER_EXPIRED');
  end if;
  if p_accept then
    if not exists (select 1 from public.drivers where id = auth.uid() and status = 'verified') then
      raise exception 'DRIVER_NOT_VERIFIED' using errcode = '42501';
    end if;
    update public.delivery_assignments set status = 'accepted', responded_at = now() where id = p_assignment_id;
    update public.orders set status = 'driver_assigned' where id = v_a.order_id;
  else
    update public.delivery_assignments set status = 'refused', responded_at = now(), refusal_reason = p_reason
     where id = p_assignment_id;
    perform public.assign_next_driver(v_a.order_id);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Offres expirées → proposées au livreur suivant (à planifier via pg_cron, chaque minute)
create or replace function public.expire_stale_offers()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id, order_id from public.delivery_assignments
           where status = 'offered' and expires_at < now() for update skip locked
  loop
    update public.delivery_assignments set status = 'expired', responded_at = now() where id = r.id;
    perform public.assign_next_driver(r.order_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.expire_stale_offers() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Progression des statuts selon le rôle
-- ---------------------------------------------------------------------
create or replace function public.advance_order_status(p_order_id uuid, p_status public.order_status, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_allowed boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if public.is_super_admin() then
    v_allowed := true;
  elsif public.is_store_manager(v_order.store_id) then
    v_allowed := (v_order.status::text || '>' || p_status::text) in (
      'sent_to_store>preparing', 'preparing>verified', 'verified>packed', 'packed>ready');
  elsif public.is_order_driver(p_order_id) then
    v_allowed := (v_order.status::text || '>' || p_status::text) in (
      'driver_assigned>driver_to_store', 'picked_up>in_delivery', 'in_delivery>driver_near',
      'driver_near>driver_arrived', 'in_delivery>driver_arrived', 'driver_arrived>recipient_check');
  end if;

  if not v_allowed then
    raise exception 'TRANSITION_NOT_ALLOWED' using detail = v_order.status::text || ' -> ' || p_status::text;
  end if;
  if v_order.payment_status <> 'succeeded' and p_status <> 'cancelled' then
    raise exception 'ORDER_NOT_PAID';
  end if;

  update public.orders set status = p_status where id = p_order_id;
  if p_note is not null then
    update public.order_status_history set note = p_note
     where id = (select max(id) from public.order_status_history where order_id = p_order_id);
  end if;

  if p_status = 'ready' then
    perform public.assign_next_driver(p_order_id);
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- Le livreur scanne le code colis au magasin
create or replace function public.confirm_pickup(p_order_id uuid, p_package_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_a public.delivery_assignments;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  select * into v_a from public.delivery_assignments
   where order_id = p_order_id and driver_id = auth.uid() and status = 'accepted';
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_order.status not in ('driver_assigned','driver_to_store') then raise exception 'TRANSITION_NOT_ALLOWED'; end if;
  if upper(trim(p_package_code)) <> v_order.package_code then raise exception 'PACKAGE_CODE_MISMATCH'; end if;
  update public.delivery_assignments set items_checked_at = now(), picked_up_at = now() where id = v_a.id;
  insert into public.delivery_proofs (assignment_id, kind, data)
  values (v_a.id, 'pickup_scan', jsonb_build_object('package_code', v_order.package_code));
  update public.orders set status = 'picked_up' where id = p_order_id;
  return jsonb_build_object('ok', true);
end $$;

-- Vérification OTP par le livreur (le code ne lui est jamais montré)
create or replace function public.verify_delivery_otp(p_order_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_otp public.delivery_otps;
  v_order public.orders;
  v_a public.delivery_assignments;
  v_fee_share numeric := coalesce((public.setting('delivery')->>'driver_fee_share')::numeric, 1);
begin
  select * into v_a from public.delivery_assignments
   where order_id = p_order_id and driver_id = auth.uid() and status = 'accepted' for update;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status not in ('driver_arrived','recipient_check') then raise exception 'TRANSITION_NOT_ALLOWED'; end if;

  select * into v_otp from public.delivery_otps where order_id = p_order_id for update;
  if not found then raise exception 'OTP_MISSING'; end if;
  if v_otp.attempts >= 5 then raise exception 'OTP_LOCKED'; end if;
  if v_otp.code <> trim(p_code) then
    update public.delivery_otps set attempts = attempts + 1 where order_id = p_order_id;
    return jsonb_build_object('ok', false, 'attempts_left', 4 - v_otp.attempts);
  end if;

  update public.delivery_otps set verified_at = now() where order_id = p_order_id;
  update public.delivery_assignments set status = 'completed', delivered_at = now() where id = v_a.id;
  insert into public.delivery_proofs (assignment_id, kind, data) values (v_a.id, 'otp_verified', '{}'::jsonb);
  update public.orders set status = 'delivered' where id = p_order_id;
  update public.orders set status = 'completed' where id = p_order_id;

  insert into public.driver_transactions (driver_id, order_id, amount_usd, kind, paid_by)
  values (v_a.driver_id, p_order_id, round(v_order.delivery_fee_usd * v_fee_share, 2), 'delivery_fee',
          coalesce(public.setting('delivery')->>'driver_paid_by', 'platform'));
  insert into public.driver_wallets (driver_id, balance_usd) values (v_a.driver_id, round(v_order.delivery_fee_usd * v_fee_share, 2))
  on conflict (driver_id) do update set balance_usd = public.driver_wallets.balance_usd + excluded.balance_usd, updated_at = now();
  insert into public.financial_ledger (entry_type, order_id, store_id, driver_id, amount_usd, description)
  values ('driver_payout_due', p_order_id, v_order.store_id, v_a.driver_id, round(v_order.delivery_fee_usd * v_fee_share, 2), 'Frais de livraison dus');

  perform public._award_loyalty(p_order_id);
  return jsonb_build_object('ok', true);
end $$;

-- Position du livreur (partage volontaire)
create or replace function public.update_driver_location(p_lat double precision, p_lng double precision, p_share boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.drivers set current_latitude = p_lat, current_longitude = p_lng,
         location_shared = p_share, location_updated_at = now()
   where id = auth.uid();
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_share then
    insert into public.delivery_tracking (assignment_id, latitude, longitude)
    select a.id, p_lat, p_lng from public.delivery_assignments a
    where a.driver_id = auth.uid() and a.status = 'accepted';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Suivi de commande pour le client (livreur, position partagée, étapes)
-- ---------------------------------------------------------------------
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
        'delivered_at', v_a.delivered_at, 'eta_minutes', v_a.eta_minutes) end,
    'driver', v_driver,
    'position', v_pos,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('status', h.status, 'at', h.created_at, 'note', h.note) order by h.created_at), '[]'::jsonb)
                from public.order_status_history h where h.order_id = p_order_id));
end $$;

-- ---------------------------------------------------------------------
-- Droits d'exécution : uniquement les utilisateurs connectés
-- ---------------------------------------------------------------------
revoke execute on function public.add_to_cart(uuid, numeric, boolean) from public, anon;
revoke execute on function public.set_cart_quantity(uuid, numeric) from public, anon;
revoke execute on function public.quote_order(uuid, text, integer) from public, anon;
revoke execute on function public.place_order(uuid, text, text, integer, public.currency_code) from public, anon;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
revoke execute on function public.assign_next_driver(uuid) from public, anon;
revoke execute on function public.respond_to_offer(uuid, boolean, text) from public, anon;
revoke execute on function public.advance_order_status(uuid, public.order_status, text) from public, anon;
revoke execute on function public.confirm_pickup(uuid, text) from public, anon;
revoke execute on function public.verify_delivery_otp(uuid, text) from public, anon;
revoke execute on function public.update_driver_location(double precision, double precision, boolean) from public, anon;
revoke execute on function public.get_order_tracking(uuid) from public, anon;

-- Temps réel
alter publication supabase_realtime add table public.orders, public.order_status_history,
  public.delivery_tracking, public.notifications, public.messages, public.delivery_assignments;
