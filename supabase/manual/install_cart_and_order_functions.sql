-- =====================================================================
-- KIN MARCHÉ EN LIGNE — 2 fonctions à installer manuellement
-- Supabase > projet « Kin Marché en ligne » > SQL Editor > coller > Run
-- (elles vident le panier du client après commande : Supabase demande
--  une confirmation que l'outil d'installation automatique ne peut pas afficher)
-- =====================================================================

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
revoke execute on function public.add_to_cart(uuid, numeric, boolean) from public, anon;

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
revoke execute on function public.place_order(uuid, text, text, integer, public.currency_code) from public, anon;
