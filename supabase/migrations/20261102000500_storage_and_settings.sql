-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Stockage des fichiers et paramètres initiaux
-- =====================================================================

-- ---------------------------------------------------------------------
-- Buckets
--   branding         : logo, bannières (public, écriture admin)
--   product-media    : photos / vidéos produits (public, écriture gestionnaires)
--   avatars          : photos de profil (public, chacun son dossier)
--   driver-documents : pièces d'identité (PRIVÉ : livreur + admin)
--   cake-references  : photos de référence gâteaux (PRIVÉ : client + magasins)
--   delivery-proofs  : preuves de livraison (PRIVÉ)
-- Convention : le premier dossier du chemin = identifiant de l'utilisateur.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('branding', 'branding', true, 5242880, array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('product-media', 'product-media', true, 52428800, array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime']),
  ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp']),
  ('driver-documents', 'driver-documents', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf']),
  ('cake-references', 'cake-references', false, 10485760, array['image/png','image/jpeg','image/webp']),
  ('delivery-proofs', 'delivery-proofs', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "km branding : écriture admin" on storage.objects for all to authenticated
  using (bucket_id = 'branding' and public.is_super_admin())
  with check (bucket_id = 'branding' and public.is_super_admin());

create policy "km produits : écriture gestionnaires" on storage.objects for all to authenticated
  using (bucket_id = 'product-media' and (public.is_super_admin() or public.current_app_role() = 'store_admin'))
  with check (bucket_id = 'product-media' and (public.is_super_admin() or public.current_app_role() = 'store_admin'));

create policy "km avatars : son dossier" on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "km documents livreur : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_super_admin()));
create policy "km documents livreur : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "km gâteaux : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'cake-references' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_super_admin()
    or public.current_app_role() = 'store_admin'));
create policy "km gâteaux : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'cake-references' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "km preuves : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'delivery-proofs' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or public.is_super_admin()
    or public.current_app_role() = 'store_admin'));
create policy "km preuves : dépôt livreur" on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.current_app_role() = 'driver');

-- ---------------------------------------------------------------------
-- Paramètres initiaux (modifiables par l'administrateur général)
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('branding', jsonb_build_object(
     'app_name', 'Kin Marché en ligne',
     'tagline', 'Au prix du Grand Marché',
     'company', 'Kin Marché',
     'parent_company', 'Groupe BNB',
     'founded', 2004,
     'headquarters', 'Kinshasa, RDC',
     'logo_wide_url', null,        -- logo horizontal (thème) — à déposer dans le bucket « branding »
     'app_icon_url', null,         -- logo carré KM
     'colors', jsonb_build_object(
        'primary', '#DE3530',      -- rouge du logo Kin Marché
        'primary_dark', '#B5241F',
        'accent', '#0097FC',       -- bleu de l'anneau
        'accent_2', '#01789D')     -- bleu-vert de l'anneau
   )),
  ('developer', jsonb_build_object(
     'name', 'MATULA DESIGN', 'phone', '+243849009239', 'whatsapp', '+243849009239', 'email', 'omalbac@gmail.com')),
  ('loyalty', jsonb_build_object(
     'earn_per_usd', 1, 'point_value_usd', 0.01, 'max_redeem_ratio', 0.5, 'expiry_days', 365,
     'tiers', jsonb_build_object('silver', 500, 'gold', 2000))),
  ('orders', jsonb_build_object('unpaid_expiry_minutes', 30, 'single_store_cart', true)),
  ('delivery', jsonb_build_object('offer_timeout_seconds', 120, 'driver_fee_share', 1, 'driver_paid_by', 'platform')),
  ('finance', jsonb_build_object('platform_commission_rate', 0)),
  ('payments', jsonb_build_object(
     'cash_on_delivery', false,
     'enabled_methods', jsonb_build_array(),   -- activées seulement quand un prestataire est réellement intégré
     'provider', null)),
  ('support', jsonb_build_object('phone', null, 'whatsapp', null, 'email', null)),
  ('languages', jsonb_build_array('fr','en','ln','sw'))
on conflict (key) do nothing;

-- Taux : seul l'USD (référence) est fixé. Le CDF et l'EUR doivent être
-- saisis par l'administrateur avec leur date — aucun taux n'est inventé.
insert into public.exchange_rates (currency, rate_per_usd) values ('USD', 1)
on conflict (currency) do nothing;

-- ---------------------------------------------------------------------
-- Catégories du cahier des charges
-- (traductions lingala / swahili à faire valider par un locuteur natif)
-- ---------------------------------------------------------------------
insert into public.product_categories (slug, name, icon, sort_order) values
  ('fruits-legumes',   '{"fr":"Fruits et légumes","en":"Fruits & vegetables","ln":"Mbuma na ndunda","sw":"Matunda na mboga"}', 'nutrition', 1),
  ('viandes-volailles','{"fr":"Viandes et volailles","en":"Meat & poultry","ln":"Mosuni na bisusu","sw":"Nyama na kuku"}', 'restaurant', 2),
  ('poissons',         '{"fr":"Poissons","en":"Fish","ln":"Mbisi","sw":"Samaki"}', 'fish', 3),
  ('produits-laitiers','{"fr":"Produits laitiers","en":"Dairy","ln":"Miliki mpe biloko na yango","sw":"Bidhaa za maziwa"}', 'water', 4),
  ('boulangerie',      '{"fr":"Boulangerie et pâtisserie","en":"Bakery & pastry","ln":"Mampa mpe gato","sw":"Mikate na keki"}', 'cafe', 5),
  ('boissons',         '{"fr":"Boissons","en":"Drinks","ln":"Masanga","sw":"Vinywaji"}', 'wine', 6),
  ('epicerie',         '{"fr":"Épicerie","en":"Grocery","ln":"Biloko ya kolamba","sw":"Vyakula vya jumla"}', 'basket', 7),
  ('surgeles',         '{"fr":"Produits surgelés","en":"Frozen food","ln":"Biloko ya malili","sw":"Vyakula vilivyogandishwa"}', 'snow', 8),
  ('hygiene-beaute',   '{"fr":"Hygiène et beauté","en":"Health & beauty","ln":"Bopeto mpe kitoko","sw":"Usafi na urembo"}', 'sparkles', 9),
  ('entretien-maison', '{"fr":"Entretien de la maison","en":"Household cleaning","ln":"Bopetoli ndako","sw":"Usafi wa nyumba"}', 'home', 10),
  ('electronique',     '{"fr":"Électronique","en":"Electronics","ln":"Biloko ya kura","sw":"Vifaa vya elektroniki"}', 'phone-portrait', 11),
  ('enfants',          '{"fr":"Articles pour enfants","en":"Baby & kids","ln":"Biloko ya bana","sw":"Bidhaa za watoto"}', 'happy', 12),
  ('maison-cuisine',   '{"fr":"Maison et cuisine","en":"Home & kitchen","ln":"Ndako mpe kuku","sw":"Nyumba na jikoni"}', 'restaurant', 13),
  ('produits-locaux',  '{"fr":"Produits locaux","en":"Local products","ln":"Biloko ya mboka","sw":"Bidhaa za nyumbani"}', 'leaf', 14)
on conflict (slug) do nothing;
