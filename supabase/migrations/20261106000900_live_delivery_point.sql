-- =====================================================================
-- Position exacte du client pendant la livraison.
-- Le client peut envoyer sa position GPS actuelle : le point de remise de la commande est mis à jour
-- et le livreur le voit aussitôt sur sa carte (temps réel sur « orders »). Limité à 3 km du point
-- d'origine de l'adresse (les frais de livraison restent ceux de la commande).
-- =====================================================================

create or replace function public.update_delivery_point(
  p_order_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v public.orders;
  v_lat double precision;
  v_lng double precision;
  v_km double precision;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or (p_lat = 0 and p_lng = 0) then
    raise exception 'INVALID_POSITION' using errcode = '22023';
  end if;
  select * into v from public.orders where id = p_order_id for update;
  if v.id is null or v.customer_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v.status in ('delivered', 'completed', 'cancelled', 'failed', 'refunded') then
    raise exception 'ORDER_NOT_ACTIVE' using errcode = '22023';
  end if;

  -- Point d'origine de l'adresse (gardé à part au premier envoi).
  v_lat := coalesce((v.delivery_address->>'original_latitude')::double precision, (v.delivery_address->>'latitude')::double precision);
  v_lng := coalesce((v.delivery_address->>'original_longitude')::double precision, (v.delivery_address->>'longitude')::double precision);
  if v_lat is not null and v_lng is not null then
    v_km := public.distance_km(v_lat, v_lng, p_lat, p_lng);
    if v_km > 3 then raise exception 'TOO_FAR_FROM_ADDRESS' using errcode = '22023'; end if;
  end if;

  update public.orders
     set delivery_address = v.delivery_address
       || jsonb_build_object('latitude', p_lat, 'longitude', p_lng, 'shared_at', now(), 'shared_accuracy_m', p_accuracy)
       || case when v_lat is not null and not (v.delivery_address ? 'original_latitude')
               then jsonb_build_object('original_latitude', v_lat, 'original_longitude', v_lng) else '{}'::jsonb end
   where id = p_order_id;
  return jsonb_build_object('ok', true, 'distance_km', round(coalesce(v_km, 0)::numeric, 3));
end $fn$;

revoke execute on function public.update_delivery_point(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.update_delivery_point(uuid, double precision, double precision, double precision) to authenticated;
