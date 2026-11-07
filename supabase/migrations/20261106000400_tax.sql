-- =====================================================================
-- Taxe sur les achats (TVA 16 % par défaut), réglée par l'administrateur général
-- (Administration → Taxe sur les achats). Elle s'ajoute à chaque commande :
--   taxe = (sous-total − réduction coupon − réduction fidélité) × taux
--   total = sous-total + livraison − réductions + taxe
-- Le taux et le montant sont enregistrés sur chaque commande (une commande passée garde son taux).
-- =====================================================================

alter table public.orders add column if not exists tax_rate numeric(5,2) not null default 0
  check (tax_rate >= 0 and tax_rate <= 100);
alter table public.orders add column if not exists tax_usd numeric(12,2) not null default 0
  check (tax_usd >= 0);

-- Réglage par défaut : TVA 16 % active (modifiable dans l'administration).
insert into public.app_settings (key, value)
values ('tax', jsonb_build_object('enabled', true, 'rate', 16, 'label', 'TVA'))
on conflict (key) do nothing;

-- Taux appliqué maintenant (0 si la taxe est désactivée), entre 0 et 100.
create or replace function public.current_tax_rate()
returns numeric language sql stable security definer set search_path = '' as $$
  select case when coalesce((v ->> 'enabled')::boolean, false)
              then least(greatest(coalesce((v ->> 'rate')::numeric, 0), 0), 100) else 0 end
  from (select (select value from public.app_settings where key = 'tax') as v) s
$$;
revoke execute on function public.current_tax_rate() from public, anon, authenticated;

-- Devis de commande (écran de paiement et place_order) : la taxe s'ajoute au total.
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
  v_tax_rate numeric := public.current_tax_rate();
  v_tax numeric := 0;
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

  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select * into v_coupon from public.coupons where upper(code) = upper(trim(p_coupon_code));
    if not found or not v_coupon.is_active
       or (v_coupon.starts_at is not null and v_coupon.starts_at > now())
       or (v_coupon.ends_at is not null and v_coupon.ends_at < now())
       or (v_coupon.store_id is not null and v_coupon.store_id <> v_cart.store_id)
       or (v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit)
       or (v_coupon.assigned_user_id is not null and v_coupon.assigned_user_id is distinct from p_user) then
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

  select case when card_status = 'active' then greatest(points_balance - locked_points, 0) else 0 end into v_balance from public.loyalty_accounts where user_id = p_user;
  v_points := least(v_points, coalesce(v_balance, 0));
  v_points := least(v_points, floor(((v_subtotal - v_coupon_discount) * v_max_ratio) / v_point_value)::integer);
  v_points := greatest(v_points, 0);
  v_loyalty_discount := round(v_points * v_point_value, 2);

  -- Taxe sur les achats : sur les produits, après les réductions (pas sur les frais de livraison).
  v_tax := round(greatest(v_subtotal - v_coupon_discount - v_loyalty_discount, 0) * v_tax_rate / 100, 2);

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
    'tax_rate', v_tax_rate,
    'tax_label', coalesce(nullif(trim(public.setting('tax') ->> 'label'), ''), 'TVA'),
    'tax_usd', v_tax,
    'total_usd', greatest(round(v_subtotal + v_fee - v_coupon_discount - v_loyalty_discount + v_tax, 2), 0),
    'avg_prep_minutes', v_store.avg_prep_minutes,
    'issues', v_issues);
end $$;
revoke execute on function public._order_quote(uuid, uuid, text, integer) from public, anon, authenticated;

-- Passage de commande : identique, avec le taux et le montant de la taxe enregistrés sur la commande.
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
    loyalty_points_used, loyalty_discount_usd, tax_rate, tax_usd, total_usd,
    delivery_address, delivery_instructions)
  values (
    v_number, v_uid, (v_quote->>'store_id')::uuid, p_currency, v_rate,
    (v_quote->>'subtotal_usd')::numeric, (v_quote->>'delivery_fee_usd')::numeric,
    nullif(v_quote->>'coupon_id','')::uuid, (v_quote->>'coupon_discount_usd')::numeric,
    (v_quote->>'points_used')::integer, (v_quote->>'loyalty_discount_usd')::numeric,
    coalesce((v_quote->>'tax_rate')::numeric, 0), coalesce((v_quote->>'tax_usd')::numeric, 0),
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

  perform public.write_audit('order_placed', 'orders', v_order_id::text,
    jsonb_build_object('total_usd', v_quote->'total_usd', 'tax_usd', v_quote->'tax_usd'));

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_number, 'total_usd', (v_quote->>'total_usd')::numeric);
end $$;
revoke execute on function public.place_order(uuid, text, text, integer, public.currency_code) from public, anon;
grant execute on function public.place_order(uuid, text, text, integer, public.currency_code) to authenticated;

-- Taxe collectée (commandes payées), pour l'administration.
create or replace function public.tax_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := date_trunc('month', now() at time zone 'Africa/Kinshasa') at time zone 'Africa/Kinshasa';
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'month_tax_usd', coalesce(sum(tax_usd) filter (where paid_at >= v_start), 0),
    'month_orders', count(*) filter (where paid_at >= v_start and tax_usd > 0),
    'total_tax_usd', coalesce(sum(tax_usd), 0),
    'total_orders', count(*) filter (where tax_usd > 0))
    from public.orders
    where payment_status = 'succeeded');
end $$;
revoke execute on function public.tax_summary() from public, anon;
grant execute on function public.tax_summary() to authenticated;
