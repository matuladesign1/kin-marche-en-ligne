-- =====================================================================
-- Espace livreur : un livreur ne reçoit que des notifications de livreur
-- (courses proposées, messages, compte livreur), jamais celles d'un client
-- (suivi de ses commandes, fidélité, roue, promotions, bienvenue, preuve de paiement).
-- =====================================================================

create or replace function public._customer_only_kind(p_kind text)
returns boolean language sql immutable set search_path = '' as $$
  select p_kind in ('order_status', 'loyalty', 'wheel', 'promo', 'marketing', 'welcome', 'payment_proof')
$$;

create or replace function public.tg_notification_driver_filter()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public._customer_only_kind(new.kind)
     and exists (select 1 from public.profiles where id = new.user_id and role = 'driver') then
    return null;   -- notification de client : pas pour un livreur (ni enregistrée, ni envoyée en push)
  end if;
  return new;
end $$;

drop trigger if exists notifications_driver_filter on public.notifications;
create trigger notifications_driver_filter before insert on public.notifications
  for each row execute function public.tg_notification_driver_filter();
