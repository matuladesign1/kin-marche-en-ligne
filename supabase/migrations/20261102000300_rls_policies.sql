-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Row Level Security
-- Principe : tout est fermé par défaut, chaque accès est explicite.
-- Les insertions de commandes, paiements, stock vendu et points de
-- fidélité ne sont possibles que via les fonctions serveur.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'app_settings','exchange_rates','exchange_rate_history','profiles','customer_profiles',
    'stores','store_addresses','store_managers','product_categories','products','product_images',
    'product_videos','store_inventory','favorites','addresses','coupons','promotions','banners',
    'partners','carts','cart_items','orders','order_items','order_status_history','delivery_otps',
    'payments','refunds','financial_ledger','budgets','budget_allocations','drivers',
    'driver_documents','driver_vehicles','driver_wallets','driver_transactions',
    'delivery_assignments','delivery_tracking','delivery_proofs','delivery_incidents',
    'loyalty_accounts','loyalty_transactions','cake_orders','reviews','support_tickets',
    'messages','notifications','push_tokens','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------- Paramètres et devises ----------------
create policy "settings lisibles par tous" on public.app_settings for select using (true);
create policy "settings admin" on public.app_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "taux lisibles par tous" on public.exchange_rates for select using (true);
create policy "taux admin" on public.exchange_rates for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "historique taux admin" on public.exchange_rate_history for select to authenticated
  using (public.is_super_admin());

-- ---------------- Profils ----------------
create policy "profil : lecture soi-même ou admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_super_admin());
create policy "profil : mise à jour soi-même ou admin" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_super_admin())
  with check (id = (select auth.uid()) or public.is_super_admin());

create policy "profil client : soi-même" on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());
create policy "profil client : maj soi-même" on public.customer_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------- Magasins ----------------
create policy "magasins actifs publics" on public.stores for select
  using (is_active or public.is_super_admin() or public.is_store_manager(id));
create policy "magasins : création admin" on public.stores for insert to authenticated
  with check (public.is_super_admin());
create policy "magasins : maj admin ou directeur" on public.stores for update to authenticated
  using (public.is_super_admin() or public.is_store_manager(id))
  with check (public.is_super_admin() or public.is_store_manager(id));
create policy "magasins : suppression admin" on public.stores for delete to authenticated
  using (public.is_super_admin());

create policy "adresses magasins publiques" on public.store_addresses for select using (true);
create policy "adresses magasins admin" on public.store_addresses for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "gestionnaires : lecture" on public.store_managers for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin() or public.is_store_manager(store_id));
create policy "gestionnaires : admin" on public.store_managers for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------- Catalogue ----------------
create policy "catégories publiques" on public.product_categories for select
  using (is_active or public.is_super_admin());
create policy "catégories admin" on public.product_categories for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "produits publics" on public.products for select
  using (is_active or public.is_super_admin() or public.current_app_role() = 'store_admin');
create policy "produits : création gestionnaire/admin" on public.products for insert to authenticated
  with check ((public.is_super_admin() or public.current_app_role() = 'store_admin') and created_by = (select auth.uid()));
create or replace function public.can_manage_product(p_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or (
    public.current_app_role() = 'store_admin' and (
      exists (select 1 from public.products p where p.id = p_product_id and p.created_by = auth.uid())
      or exists (select 1 from public.store_inventory i where i.product_id = p_product_id and public.is_store_manager(i.store_id))))
$$;

create policy "produits : maj gestionnaire/admin" on public.products for update to authenticated
  using (public.can_manage_product(id))
  with check (public.can_manage_product(id));
create policy "produits : suppression admin" on public.products for delete to authenticated
  using (public.is_super_admin());

create policy "images publiques" on public.product_images for select using (true);
create policy "images : gestion" on public.product_images for all to authenticated
  using (public.can_manage_product(product_id))
  with check (public.can_manage_product(product_id));

create policy "vidéos publiques" on public.product_videos for select using (true);
create policy "vidéos : gestion" on public.product_videos for all to authenticated
  using (public.can_manage_product(product_id))
  with check (public.can_manage_product(product_id));

create policy "stock public" on public.store_inventory for select using (true);
create policy "stock : gestion magasin" on public.store_inventory for all to authenticated
  using (public.is_super_admin() or public.is_store_manager(store_id))
  with check (public.is_super_admin() or public.is_store_manager(store_id));

create policy "favoris : soi-même" on public.favorites for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "adresses : soi-même" on public.addresses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "adresses : admin lecture" on public.addresses for select to authenticated
  using (public.is_super_admin());

-- ---------------- Marketing ----------------
create policy "coupons publics actifs" on public.coupons for select to authenticated
  using ((is_public and is_active and (ends_at is null or ends_at > now()))
         or public.is_super_admin() or (store_id is not null and public.is_store_manager(store_id)));
create policy "coupons admin" on public.coupons for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "promotions publiques" on public.promotions for select
  using (is_active or public.is_super_admin() or (store_id is not null and public.is_store_manager(store_id)));
create policy "promotions : gestion" on public.promotions for all to authenticated
  using (public.is_super_admin() or (store_id is not null and public.is_store_manager(store_id)))
  with check (public.is_super_admin() or (store_id is not null and public.is_store_manager(store_id)));

create policy "bannières publiques" on public.banners for select using (is_active or public.is_super_admin());
create policy "bannières admin" on public.banners for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "partenaires publics" on public.partners for select using (is_active or public.is_super_admin());
create policy "partenaires admin" on public.partners for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------- Panier (ajout uniquement via add_to_cart) ----------------
create policy "panier : soi-même" on public.carts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "articles panier : lecture" on public.cart_items for select to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));
create policy "articles panier : maj" on public.cart_items for update to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));
create policy "articles panier : suppression" on public.cart_items for delete to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));

-- ---------------- Commandes ----------------
create policy "commandes : lecture autorisée" on public.orders for select to authenticated
  using (public.can_view_order(id));
create policy "lignes commande : lecture" on public.order_items for select to authenticated
  using (public.can_view_order(order_id));
create policy "historique statut : lecture" on public.order_status_history for select to authenticated
  using (public.can_view_order(order_id));
-- Le code OTP n'est visible QUE par le client destinataire.
create policy "otp : client uniquement" on public.delivery_otps for select to authenticated
  using (public.is_order_customer(order_id));

-- ---------------- Paiements (aucune écriture côté client) ----------------
create policy "paiements : lecture" on public.payments for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_super_admin() or public.is_order_store_manager(order_id));
create policy "remboursements : lecture" on public.refunds for select to authenticated
  using (public.is_super_admin() or public.is_order_customer(order_id) or public.is_order_store_manager(order_id));

create policy "journal financier : admin ou magasin" on public.financial_ledger for select to authenticated
  using (public.is_super_admin() or (store_id is not null and public.is_store_manager(store_id)));
create policy "budgets : admin" on public.budgets for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy "allocations : admin ou magasin" on public.budget_allocations for select to authenticated
  using (public.is_super_admin() or public.is_store_manager(store_id));
create policy "allocations : admin écriture" on public.budget_allocations for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------- Livreurs ----------------
create policy "livreur : lecture" on public.drivers for select to authenticated
  using (id = (select auth.uid()) or public.is_super_admin()
         or (public.current_app_role() = 'store_admin' and status = 'verified'));
create policy "livreur : inscription" on public.drivers for insert to authenticated
  with check (id = (select auth.uid()) and status = 'pending_review' and not is_available);
create policy "livreur : maj" on public.drivers for update to authenticated
  using (id = (select auth.uid()) or public.is_super_admin())
  with check (id = (select auth.uid()) or public.is_super_admin());

create policy "documents livreur : soi-même" on public.driver_documents for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_super_admin());
create policy "documents livreur : dépôt" on public.driver_documents for insert to authenticated
  with check (driver_id = (select auth.uid()) and status = 'pending');
create policy "documents livreur : revue admin" on public.driver_documents for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "véhicules : lecture" on public.driver_vehicles for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_super_admin() or public.current_app_role() = 'store_admin');
create policy "véhicules : soi-même" on public.driver_vehicles for all to authenticated
  using (driver_id = (select auth.uid()) or public.is_super_admin())
  with check (driver_id = (select auth.uid()) or public.is_super_admin());

create policy "portefeuille : lecture" on public.driver_wallets for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_super_admin());
create policy "transactions livreur : lecture" on public.driver_transactions for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_super_admin());

create policy "missions : lecture" on public.delivery_assignments for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_super_admin()
         or public.is_order_store_manager(order_id) or public.is_order_customer(order_id));

create policy "suivi GPS : lecture" on public.delivery_tracking for select to authenticated
  using (exists (select 1 from public.delivery_assignments a where a.id = assignment_id
    and (a.driver_id = (select auth.uid()) or public.is_super_admin()
         or public.is_order_store_manager(a.order_id)
         or (public.is_order_customer(a.order_id) and a.status = 'accepted'))));
create policy "suivi GPS : envoi livreur" on public.delivery_tracking for insert to authenticated
  with check (exists (select 1 from public.delivery_assignments a where a.id = assignment_id
    and a.driver_id = (select auth.uid()) and a.status = 'accepted'));

create policy "preuves : lecture" on public.delivery_proofs for select to authenticated
  using (exists (select 1 from public.delivery_assignments a where a.id = assignment_id
    and (a.driver_id = (select auth.uid()) or public.is_super_admin() or public.is_order_store_manager(a.order_id))));
create policy "preuves : envoi livreur" on public.delivery_proofs for insert to authenticated
  with check (exists (select 1 from public.delivery_assignments a where a.id = assignment_id
    and a.driver_id = (select auth.uid()) and a.status = 'accepted'));

create policy "incidents : lecture" on public.delivery_incidents for select to authenticated
  using (public.can_view_order(order_id));
create policy "incidents : signalement" on public.delivery_incidents for insert to authenticated
  with check (reported_by = (select auth.uid()) and public.can_view_order(order_id));
create policy "incidents : résolution" on public.delivery_incidents for update to authenticated
  using (public.is_super_admin() or public.is_order_store_manager(order_id))
  with check (public.is_super_admin() or public.is_order_store_manager(order_id));

-- ---------------- Fidélité ----------------
create policy "fidélité : soi-même" on public.loyalty_accounts for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());
create policy "fidélité historique : soi-même" on public.loyalty_transactions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());

-- ---------------- Gâteaux ----------------
create policy "gâteaux : lecture" on public.cake_orders for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_super_admin() or public.is_store_manager(store_id));
create policy "gâteaux : création client" on public.cake_orders for insert to authenticated
  with check (customer_id = (select auth.uid()) and status = 'submitted'
              and quoted_price_usd is null and order_id is null);
create policy "gâteaux : devis magasin" on public.cake_orders for update to authenticated
  using (public.is_super_admin() or public.is_store_manager(store_id))
  with check (public.is_super_admin() or public.is_store_manager(store_id));

-- ---------------- Avis ----------------
create policy "avis : lecture" on public.reviews for select
  using (status = 'approved' or author_id = (select auth.uid()) or public.is_super_admin());
create policy "avis : création" on public.reviews for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy "avis : modération" on public.reviews for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy "avis : suppression" on public.reviews for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_super_admin());

-- ---------------- Assistance ----------------
create or replace function public.can_view_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_tickets t where t.id = p_ticket_id and (
      t.customer_id = auth.uid() or public.is_super_admin()
      or (t.channel = 'store' and t.store_id is not null and public.is_store_manager(t.store_id))
      or (t.channel = 'driver' and t.order_id is not null and public.is_order_driver(t.order_id))))
$$;

create policy "tickets : lecture" on public.support_tickets for select to authenticated
  using (public.can_view_ticket(id));
create policy "tickets : création client" on public.support_tickets for insert to authenticated
  with check (customer_id = (select auth.uid()) and status = 'open'
              and (order_id is null or public.is_order_customer(order_id)));
create policy "tickets : maj" on public.support_tickets for update to authenticated
  using (public.can_view_ticket(id)) with check (public.can_view_ticket(id));

create policy "messages : lecture" on public.messages for select to authenticated
  using (public.can_view_ticket(ticket_id));
create policy "messages : envoi" on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.can_view_ticket(ticket_id));

-- ---------------- Notifications ----------------
create policy "notifications : soi-même" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications : marquer lu" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications : suppression" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "push tokens : soi-même" on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------- Audit ----------------
create policy "audit : admin" on public.audit_log for select to authenticated
  using (public.is_super_admin());

-- Les fonctions utilitaires internes ne doivent pas être appelées par anon
revoke execute on function public.write_audit(text, text, text, jsonb) from public, anon, authenticated;
