-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Schéma principal
-- Développeur : MATULA DESIGN
-- Toutes les tables sont protégées par RLS. Les écritures sensibles
-- (commandes, paiements, stock, fidélité) passent par des fonctions
-- SECURITY DEFINER ou par le rôle service (serveur).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
create type public.app_role as enum ('customer', 'store_admin', 'driver', 'super_admin');
create type public.app_language as enum ('fr', 'en', 'ln', 'sw');
create type public.currency_code as enum ('USD', 'CDF', 'EUR');
create type public.sale_unit as enum ('unit', 'kg', 'g', 'litre', 'ml', 'pack', 'carton');

create type public.order_status as enum (
  'received',            -- 1. Commande reçue
  'payment_confirmed',   -- 2. Paiement confirmé
  'sent_to_store',       -- 3. Commande transmise au supermarché
  'preparing',           -- 4. Préparation des produits
  'verified',            -- 5. Produits vérifiés
  'packed',              -- 6. Colis emballés
  'ready',               -- 7. Commande prête
  'driver_assigned',     -- 8. Livreur assigné
  'driver_to_store',     -- 9. Livreur en route vers le magasin
  'picked_up',           -- 10. Colis récupérés
  'in_delivery',         -- 11. Livraison en cours
  'driver_near',         -- 12. Livreur proche du domicile
  'driver_arrived',      -- 13. Livreur arrivé
  'recipient_check',     -- 14. Vérification du destinataire
  'delivered',           -- 15. Livraison confirmée
  'completed',           -- 16. Commande terminée
  'cancelled',
  'failed',
  'refunded'
);

create type public.payment_status as enum ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');
create type public.payment_method as enum ('mpesa', 'orange_money', 'airtel_money', 'afrimoney', 'visa', 'mastercard', 'bank_transfer', 'other');
create type public.driver_status as enum ('pending_review', 'verified', 'suspended', 'rejected');
create type public.transport_mode as enum ('foot', 'bicycle', 'motorbike', 'car', 'van', 'truck');
create type public.assignment_status as enum ('offered', 'accepted', 'refused', 'expired', 'cancelled', 'completed');
create type public.incident_type as enum ('missing_item', 'damaged_item', 'failed_delivery', 'return', 'accident', 'other');
create type public.ticket_status as enum ('open', 'pending', 'resolved', 'closed');
create type public.moderation_status as enum ('pending', 'approved', 'rejected');
create type public.loyalty_tx_type as enum ('earn', 'redeem', 'expire', 'adjust', 'refund_reversal');
create type public.discount_type as enum ('percent', 'fixed');

-- ---------------------------------------------------------------------
-- Utilitaire updated_at
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Paramètres de l'application (logo, couleurs, textes) — modifiables
-- par l'administrateur général sans toucher au code.
-- ---------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table public.exchange_rates (
  currency public.currency_code primary key,
  -- nombre d'unités de la devise pour 1 USD
  rate_per_usd numeric(18,6) not null check (rate_per_usd > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table public.exchange_rate_history (
  id bigint generated always as identity primary key,
  currency public.currency_code not null,
  rate_per_usd numeric(18,6) not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id)
);

-- ---------------------------------------------------------------------
-- Utilisateurs
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  full_name text,
  phone text,
  email text,
  avatar_url text,
  language public.app_language not null default 'fr',
  currency public.currency_code not null default 'USD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create table public.customer_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  default_address_id uuid,
  preferred_store_id uuid,
  birth_date date,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Magasins
-- ---------------------------------------------------------------------
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  province text,
  city text,
  commune text,
  quartier text,
  avenue text,
  street_number text,
  landmark text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  address_verified boolean not null default false,
  phone text,
  opening_hours jsonb not null default '{}'::jsonb,
  manager_name text,
  assistant_name text,
  is_open boolean not null default true,
  is_active boolean not null default true,
  delivery_radius_km numeric(6,2) not null default 5 check (delivery_radius_km >= 0),
  delivery_fee_usd numeric(10,2) not null default 0 check (delivery_fee_usd >= 0),
  delivery_fee_per_km_usd numeric(10,2) not null default 0 check (delivery_fee_per_km_usd >= 0),
  min_order_usd numeric(10,2) not null default 0,
  avg_prep_minutes integer not null default 30 check (avg_prep_minutes >= 0),
  delivery_zone jsonb,              -- liste de communes / quartiers desservis
  rating numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger stores_updated before update on public.stores
  for each row execute function public.tg_set_updated_at();

-- Adresses officielles (historique et corrections GPS)
create table public.store_addresses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  label text not null default 'principale',
  full_text text,
  latitude double precision,
  longitude double precision,
  source text,                       -- ex. « import CSV », « correction admin »
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.store_managers (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'directeur',  -- directeur | gestionnaire | assistant
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

-- ---------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null,               -- {"fr": "...", "en": "...", "ln": "...", "sw": "..."}
  icon text,
  image_url text,
  parent_id uuid references public.product_categories(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text,
  name text not null,
  name_i18n jsonb not null default '{}'::jsonb,
  description text,
  description_i18n jsonb not null default '{}'::jsonb,
  category_id uuid references public.product_categories(id) on delete set null,
  brand text,
  unit public.sale_unit not null default 'unit',
  unit_size numeric(12,3),           -- ex. 1.5 (litre), 500 (g)
  min_quantity numeric(12,3) not null default 1 check (min_quantity > 0),
  quantity_step numeric(12,3) not null default 1 check (quantity_step > 0),
  specs jsonb not null default '{}'::jsonb,
  nutrition jsonb,
  allergens text[],
  storage_conditions text,
  has_expiry boolean not null default false,
  is_local boolean not null default false,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  rating numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  search_text tsvector generated always as (
    to_tsvector('simple',
      coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(description,'') || ' ' ||
      coalesce(sku,'') || ' ' || coalesce(barcode,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index products_search_idx on public.products using gin (search_text);
create index products_category_idx on public.products (category_id);
create index products_barcode_idx on public.products (barcode);
create trigger products_updated before update on public.products
  for each row execute function public.tg_set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  alt text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id);

create table public.product_videos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  thumbnail_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_videos_product_idx on public.product_videos (product_id);

-- Stock et prix par magasin
create table public.store_inventory (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  price_usd numeric(12,2) not null check (price_usd >= 0),
  promo_price_usd numeric(12,2) check (promo_price_usd >= 0),
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  stock numeric(12,3) not null default 0 check (stock >= 0),
  low_stock_threshold numeric(12,3) not null default 5,
  expiry_date date,
  is_available boolean not null default true,
  sold_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (store_id, product_id)
);
create index store_inventory_product_idx on public.store_inventory (product_id);
create trigger store_inventory_updated before update on public.store_inventory
  for each row execute function public.tg_set_updated_at();

-- Prix effectif (promotion active ou prix normal)
create or replace function public.effective_price(inv public.store_inventory)
returns numeric language sql stable set search_path = '' as $$
  select case
    when inv.promo_price_usd is not null
     and (inv.promo_starts_at is null or inv.promo_starts_at <= now())
     and (inv.promo_ends_at   is null or inv.promo_ends_at   >= now())
    then inv.promo_price_usd
    else inv.price_usd
  end
$$;

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---------------------------------------------------------------------
-- Adresses clients
-- ---------------------------------------------------------------------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Domicile',
  recipient_name text,
  recipient_phone text,
  province text not null default 'Kinshasa',
  city text not null default 'Kinshasa',
  commune text not null,
  quartier text,
  avenue text,
  street_number text,
  landmark text,
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);

alter table public.customer_profiles
  add constraint customer_profiles_default_address_fk foreign key (default_address_id) references public.addresses(id) on delete set null,
  add constraint customer_profiles_store_fk foreign key (preferred_store_id) references public.stores(id) on delete set null;

-- ---------------------------------------------------------------------
-- Marketing : coupons, promotions, bannières, partenaires
-- ---------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type public.discount_type not null,
  discount_value numeric(12,2) not null check (discount_value > 0),
  min_order_usd numeric(12,2) not null default 0,
  max_discount_usd numeric(12,2),
  store_id uuid references public.stores(id) on delete cascade,  -- null = tous les magasins
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer,
  per_user_limit integer not null default 1,
  used_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  title_i18n jsonb not null default '{}'::jsonb,
  description text,
  image_url text,
  store_id uuid references public.stores(id) on delete cascade,
  product_ids uuid[] not null default '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text,
  title_i18n jsonb not null default '{}'::jsonb,
  image_url text not null,
  link_type text,                    -- product | category | promotion | url
  link_value text,
  store_id uuid references public.stores(id) on delete cascade,
  sort_order integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  website text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Panier
-- ---------------------------------------------------------------------
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  inventory_id uuid not null references public.store_inventory(id) on delete cascade,
  quantity numeric(12,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (cart_id, inventory_id)
);

-- ---------------------------------------------------------------------
-- Commandes
-- ---------------------------------------------------------------------
create sequence public.order_number_seq start 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  status public.order_status not null default 'received',
  payment_status public.payment_status not null default 'pending',
  display_currency public.currency_code not null default 'USD',
  exchange_rate numeric(18,6) not null default 1,
  subtotal_usd numeric(12,2) not null,
  delivery_fee_usd numeric(12,2) not null default 0,
  coupon_id uuid references public.coupons(id) on delete set null,
  coupon_discount_usd numeric(12,2) not null default 0,
  loyalty_points_used integer not null default 0,
  loyalty_discount_usd numeric(12,2) not null default 0,
  total_usd numeric(12,2) not null check (total_usd >= 0),
  delivery_address jsonb not null,
  delivery_instructions text,
  package_code text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_store_idx on public.orders (store_id, created_at desc);
create trigger orders_updated before update on public.orders
  for each row execute function public.tg_set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  inventory_id uuid references public.store_inventory(id) on delete set null,
  product_name text not null,
  unit public.sale_unit not null,
  unit_price_usd numeric(12,2) not null,
  quantity numeric(12,3) not null check (quantity > 0),
  line_total_usd numeric(12,2) not null,
  picked boolean not null default false,
  missing boolean not null default false,
  substitute_product_id uuid references public.products(id)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  note text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

-- Code OTP de livraison (jamais visible par le livreur)
create table public.delivery_otps (
  order_id uuid primary key references public.orders(id) on delete cascade,
  code text not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Paiements (écriture serveur uniquement)
-- ---------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid not null references public.profiles(id),
  method public.payment_method not null,
  provider text,                      -- nom du prestataire agréé
  provider_reference text,
  amount numeric(14,2) not null check (amount > 0),
  currency public.currency_code not null,
  amount_usd numeric(14,2) not null,
  status public.payment_status not null default 'pending',
  payer_phone_masked text,            -- ex. +243 81*****23 — jamais de PIN
  failure_reason text,
  raw_response jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);
create index payments_order_idx on public.payments (order_id);
create trigger payments_updated before update on public.payments
  for each row execute function public.tg_set_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount_usd numeric(14,2) not null check (amount_usd > 0),
  reason text,
  status public.payment_status not null default 'pending',
  provider_reference text,
  requested_by uuid references auth.users(id),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Journal financier (append-only)
create table public.financial_ledger (
  id bigint generated always as identity primary key,
  entry_type text not null,          -- sale | refund | commission | store_payout | driver_payout | expense | budget
  order_id uuid references public.orders(id),
  store_id uuid references public.stores(id),
  driver_id uuid,
  amount_usd numeric(14,2) not null,
  description text,
  reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  total_usd numeric(14,2) not null check (total_usd >= 0),
  rule jsonb not null default '{"method":"share_of_net_sales"}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  net_sales_usd numeric(14,2) not null,
  share numeric(9,6) not null,
  allocated_usd numeric(14,2) not null,
  unique (budget_id, store_id)
);

-- ---------------------------------------------------------------------
-- Livreurs
-- ---------------------------------------------------------------------
create table public.drivers (
  id uuid primary key references public.profiles(id) on delete cascade,
  driver_code text not null unique default ('KML-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  status public.driver_status not null default 'pending_review',
  address text,
  zone_communes text[] not null default '{}',
  emergency_contact_name text,
  emergency_contact_phone text,
  payout_method text,                 -- mobile_money | bank
  payout_account_masked text,
  is_available boolean not null default false,
  current_latitude double precision,
  current_longitude double precision,
  location_shared boolean not null default false,
  location_updated_at timestamptz,
  max_active_orders integer not null default 3,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  rating numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger drivers_updated before update on public.drivers
  for each row execute function public.tg_set_updated_at();

create table public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  doc_type text not null,             -- id_card | id_photo | vehicle_registration | license | other
  storage_path text not null,         -- bucket privé « driver-documents »
  status public.moderation_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.driver_vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  mode public.transport_mode not null,
  plate_number text,
  max_weight_kg numeric(8,2),
  max_volume_l numeric(10,2),
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.driver_wallets (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  balance_usd numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table public.driver_transactions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  order_id uuid references public.orders(id),
  amount_usd numeric(14,2) not null,
  kind text not null,                 -- delivery_fee | bonus | payout | adjustment
  paid_by text,                       -- store | platform
  reference text,
  created_at timestamptz not null default now()
);

create table public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  status public.assignment_status not null default 'offered',
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  responded_at timestamptz,
  refusal_reason text,
  distance_km numeric(8,2),
  eta_minutes integer,               -- calculé par le service de navigation, jamais inventé
  items_checked_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz
);
create index delivery_assignments_order_idx on public.delivery_assignments (order_id);
create index delivery_assignments_driver_idx on public.delivery_assignments (driver_id, status);

create table public.delivery_tracking (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.delivery_assignments(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  speed_kmh numeric(6,2),
  heading numeric(6,2),
  recorded_at timestamptz not null default now()
);
create index delivery_tracking_assignment_idx on public.delivery_tracking (assignment_id, recorded_at desc);

create table public.delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.delivery_assignments(id) on delete cascade,
  kind text not null,                 -- pickup_scan | otp_verified | photo | signature
  storage_path text,
  data jsonb,
  created_at timestamptz not null default now()
);

create table public.delivery_incidents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  assignment_id uuid references public.delivery_assignments(id) on delete set null,
  reported_by uuid not null references auth.users(id),
  type public.incident_type not null,
  description text,
  photo_path text,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Fidélité
-- ---------------------------------------------------------------------
create table public.loyalty_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_points integer not null default 0,
  tier text not null default 'bronze',
  updated_at timestamptz not null default now()
);

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id),
  type public.loyalty_tx_type not null,
  points integer not null,
  expires_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index loyalty_tx_user_idx on public.loyalty_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Gâteaux personnalisés
-- ---------------------------------------------------------------------
create table public.cake_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  full_name text not null,
  phone text not null,
  email text,
  cake_type text not null,
  size text,
  servings integer check (servings > 0),
  flavor text,
  color text,
  inscription text,
  reference_photo_path text,
  desired_date date not null,
  desired_time time,
  delivery_address jsonb,
  status text not null default 'submitted', -- submitted | quoted | accepted | rejected | paid | in_preparation | ready | delivered
  quoted_price_usd numeric(12,2),
  bakery_note text,
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger cake_orders_updated before update on public.cake_orders
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Avis
-- ---------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('product','store','driver','delivery')),
  product_id uuid references public.products(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (order_id, author_id, target_type, product_id)
);

-- ---------------------------------------------------------------------
-- Assistance et messagerie
-- ---------------------------------------------------------------------
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  channel text not null default 'general' check (channel in ('general','store','driver')),
  subject text not null,
  status public.ticket_status not null default 'open',
  assigned_to uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger support_tickets_updated before update on public.support_tickets
  for each row execute function public.tg_set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 4000),
  attachment_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_ticket_idx on public.messages (ticket_id, created_at);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Journal d'audit
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
