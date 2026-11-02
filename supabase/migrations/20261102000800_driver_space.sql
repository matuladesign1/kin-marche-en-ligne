-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Espace livreur
-- =====================================================================

-- Offres de mission visibles par le livreur : uniquement des informations non sensibles
-- (pas d'adresse exacte ni de téléphone du client avant acceptation).
create or replace function public.get_driver_offers()
returns table (
  assignment_id uuid, order_id uuid, order_number text, store_name text, store_commune text,
  store_latitude double precision, store_longitude double precision,
  customer_commune text, distance_km numeric, delivery_fee_usd numeric,
  items_count bigint, weight_kg numeric, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, o.id, o.order_number, s.name, s.commune, s.latitude, s.longitude,
         o.delivery_address->>'commune', a.distance_km, o.delivery_fee_usd,
         (select count(*) from public.order_items i where i.order_id = o.id),
         (select coalesce(sum(i.quantity * coalesce(p.weight_kg, case when i.unit = 'kg' then 1 else 0 end)), 0)
            from public.order_items i join public.products p on p.id = i.product_id where i.order_id = o.id),
         a.expires_at
  from public.delivery_assignments a
  join public.orders o on o.id = a.order_id
  join public.stores s on s.id = o.store_id
  where a.driver_id = auth.uid() and a.status = 'offered' and a.expires_at > now()
  order by a.offered_at
$$;
revoke execute on function public.get_driver_offers() from public, anon;

-- Inscription livreur : crée la fiche « à vérifier » (le rôle reste client jusqu'à la validation).
create or replace function public.register_driver(
  p_address text, p_zone_communes text[], p_transport public.transport_mode, p_plate text,
  p_max_weight_kg numeric, p_emergency_name text, p_emergency_phone text,
  p_payout_method text, p_payout_account text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from public.drivers where id = v_uid and status <> 'pending_review') then
    raise exception 'ALREADY_REGISTERED';
  end if;
  -- Le statut n'est jamais modifié ici : seule l'administration peut le changer.
  insert into public.drivers (id, address, zone_communes, emergency_contact_name, emergency_contact_phone, payout_method, payout_account_masked)
  values (v_uid, p_address, coalesce(p_zone_communes, '{}'), p_emergency_name, p_emergency_phone, p_payout_method,
          case when p_payout_account is null or length(p_payout_account) < 6 then p_payout_account
               else left(p_payout_account, 4) || repeat('•', greatest(length(p_payout_account) - 6, 2)) || right(p_payout_account, 2) end)
  on conflict (id) do update set address = excluded.address, zone_communes = excluded.zone_communes,
    emergency_contact_name = excluded.emergency_contact_name, emergency_contact_phone = excluded.emergency_contact_phone,
    payout_method = excluded.payout_method, payout_account_masked = excluded.payout_account_masked;
  if exists (select 1 from public.driver_vehicles where driver_id = v_uid and is_primary) then
    update public.driver_vehicles set mode = p_transport, plate_number = nullif(trim(p_plate), ''), max_weight_kg = p_max_weight_kg
     where driver_id = v_uid and is_primary;
  else
    insert into public.driver_vehicles (driver_id, mode, plate_number, max_weight_kg, is_primary)
    values (v_uid, p_transport, nullif(trim(p_plate), ''), p_max_weight_kg, true);
  end if;
  insert into public.notifications (user_id, kind, title, body, data)
  select p.id, 'driver_application', 'Nouvelle candidature livreur', coalesce(me.full_name, me.email), jsonb_build_object('driver_id', v_uid)
  from public.profiles p, public.profiles me where p.role = 'super_admin' and me.id = v_uid;
end $$;
revoke execute on function public.register_driver(text, text[], public.transport_mode, text, numeric, text, text, text, text) from public, anon;

-- Validation / suspension par l'administrateur général (rôle mis à jour en même temps).
create or replace function public.review_driver(p_driver_id uuid, p_status public.driver_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.drivers set status = p_status,
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         verified_by = case when p_status = 'verified' then auth.uid() else verified_by end,
         is_available = case when p_status = 'verified' then is_available else false end
   where id = p_driver_id;
  if not found then raise exception 'DRIVER_NOT_FOUND'; end if;
  if p_status = 'verified' then
    update public.profiles set role = 'driver' where id = p_driver_id and role = 'customer';
    update public.driver_documents set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
     where driver_id = p_driver_id and status = 'pending';
  end if;
  insert into public.notifications (user_id, kind, title, body)
  values (p_driver_id, 'driver_review',
          case p_status when 'verified' then 'Compte livreur validé' when 'suspended' then 'Compte livreur suspendu'
                        when 'rejected' then 'Candidature livreur refusée' else 'Candidature en cours d''examen' end,
          p_note);
  perform public.write_audit('driver_review', 'drivers', p_driver_id::text, jsonb_build_object('status', p_status, 'note', p_note));
end $$;
revoke execute on function public.review_driver(uuid, public.driver_status, text) from public, anon;

create or replace function public.set_driver_availability(p_available boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.drivers set is_available = p_available where id = auth.uid() and (status = 'verified' or not p_available);
  if not found then raise exception 'DRIVER_NOT_VERIFIED' using errcode = '42501'; end if;
end $$;
revoke execute on function public.set_driver_availability(boolean) from public, anon;
