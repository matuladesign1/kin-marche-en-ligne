-- Fonctions de trigger : jamais appelables via l'API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_protect_profile() from public, anon, authenticated;
revoke execute on function public.tg_protect_driver() from public, anon, authenticated;
revoke execute on function public.tg_rate_history() from public, anon, authenticated;
revoke execute on function public.tg_order_status_log() from public, anon, authenticated;
revoke execute on function public.tg_review_rating() from public, anon, authenticated;
revoke execute on function public.tg_review_guard() from public, anon, authenticated;
revoke execute on function public.setting(text) from public, anon, authenticated;

-- Aides RLS utilisées uniquement par des politiques « authenticated »
revoke execute on function public.can_manage_product(uuid) from public, anon;
revoke execute on function public.can_view_order(uuid) from public, anon;
revoke execute on function public.can_view_ticket(uuid) from public, anon;
revoke execute on function public.is_order_customer(uuid) from public, anon;
revoke execute on function public.is_order_driver(uuid) from public, anon;
revoke execute on function public.is_order_store_manager(uuid) from public, anon;
revoke execute on function public.managed_store_ids() from public, anon;
-- is_super_admin, is_store_manager et current_app_role restent exécutables par anon :
-- elles servent aux politiques de lecture publique (magasins, produits) et
-- renvoient toujours false / null pour un visiteur non connecté.
