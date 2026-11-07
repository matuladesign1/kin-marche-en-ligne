export type AppRole = 'customer' | 'store_admin' | 'driver' | 'super_admin' | 'agent' | 'pastry_chef';
export type Language = 'fr' | 'en' | 'ln' | 'sw';
export type Currency = 'USD' | 'CDF' | 'EUR';
export type SaleUnit = 'unit' | 'kg' | 'g' | 'litre' | 'ml' | 'pack' | 'carton';

export type OrderStatus =
  | 'received' | 'payment_confirmed' | 'sent_to_store' | 'preparing' | 'verified' | 'packed' | 'ready'
  | 'driver_assigned' | 'driver_to_store' | 'picked_up' | 'in_delivery' | 'driver_near' | 'driver_arrived'
  | 'recipient_check' | 'delivered' | 'completed' | 'cancelled' | 'failed' | 'refunded';

export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded';

/** Les 16 étapes officielles de livraison, dans l'ordre. */
export const ORDER_STEPS: OrderStatus[] = [
  'received', 'payment_confirmed', 'sent_to_store', 'preparing', 'verified', 'packed', 'ready',
  'driver_assigned', 'driver_to_store', 'picked_up', 'in_delivery', 'driver_near', 'driver_arrived',
  'recipient_check', 'delivered', 'completed',
];

export interface Profile {
  id: string;
  role: AppRole;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  language: Language;
  currency: Currency;
  is_active: boolean;
  /** Catégories de notifications désactivées par le client (absent = activé). */
  notification_prefs?: Partial<Record<NotificationCategory, boolean>> | null;
}

export type NotificationCategory = 'orders' | 'rewards' | 'messages' | 'promos';

export interface CatalogItem {
  inventory_id: string;
  store_id: string;
  store_name: string;
  store_commune: string | null;
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  name_i18n: Partial<Record<Language, string>>;
  brand: string | null;
  unit: SaleUnit;
  unit_size: number | null;
  min_quantity: number;
  quantity_step: number;
  category_id: string | null;
  is_featured: boolean;
  is_local: boolean;
  rating: number;
  rating_count: number;
  price_usd: number;
  effective_price_usd: number;
  on_promo: boolean;
  stock: number;
  in_stock: boolean;
  sold_count: number;
  created_at: string;
  image_url: string | null;
}

export interface Category {
  id: string;
  slug: string;
  name: Partial<Record<Language, string>>;
  icon: string | null;
  image_url: string | null;
  parent_id: string | null;
  sort_order: number;
}

export interface Store {
  id: string;
  name: string;
  province: string | null;
  city: string | null;
  commune: string | null;
  quartier: string | null;
  avenue: string | null;
  street_number: string | null;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  address_verified: boolean;
  phone: string | null;
  opening_hours: Record<string, string>;
  is_open: boolean;
  delivery_radius_km: number;
  delivery_fee_usd: number;
  avg_prep_minutes: number;
  rating: number;
  rating_count: number;
}

export interface RecommendedStore {
  store_id: string;
  name: string;
  commune: string | null;
  quartier: string | null;
  address_verified: boolean;
  latitude: number | null;
  longitude: number | null;
  is_open: boolean;
  distance_km: number | null;
  can_deliver: boolean;
  delivery_fee_usd: number;
  avg_prep_minutes: number;
  available_count: number;
  requested_count: number;
  rating: number;
}

export interface Address {
  id: string;
  label: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  province: string;
  city: string;
  commune: string;
  quartier: string | null;
  avenue: string | null;
  street_number: string | null;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
}

export interface QuoteItem {
  inventory_id: string;
  product_id: string;
  name: string;
  unit: SaleUnit;
  unit_price_usd: number;
  quantity: number;
  line_total_usd: number;
}

export interface Quote {
  store_id?: string;
  store_name?: string;
  items?: QuoteItem[];
  subtotal_usd?: number;
  distance_km?: number | null;
  delivery_fee_usd?: number;
  coupon_id?: string | null;
  coupon_discount_usd?: number;
  points_used?: number;
  points_balance?: number;
  loyalty_discount_usd?: number;
  tax_rate?: number;
  tax_label?: string;
  tax_usd?: number;
  total_usd?: number;
  avg_prep_minutes?: number;
  issues: string[];
}

export interface Order {
  id: string;
  order_number: string;
  store_id: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  display_currency: Currency;
  subtotal_usd: number;
  delivery_fee_usd: number;
  coupon_discount_usd: number;
  loyalty_discount_usd: number;
  loyalty_points_used: number;
  tax_rate?: number;
  tax_usd?: number;
  total_usd: number;
  delivery_address: Record<string, unknown>;
  delivery_instructions: string | null;
  created_at: string;
  paid_at: string | null;
  stores?: { name: string } | null;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  unit: SaleUnit;
  unit_price_usd: number;
  quantity: number;
  line_total_usd: number;
}

export interface Tracking {
  order_id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  store: { name: string; phone: string | null; latitude: number | null; longitude: number | null };
  assignment: { id: string; status: string; accepted_at: string | null; picked_up_at: string | null; delivered_at: string | null; eta_minutes: number | null; route_distance_km: number | null; eta_updated_at: string | null; eta_target: 'store' | 'customer' | null; route_polyline?: string | null } | null;
  driver: {
    name: string | null; avatar_url: string | null; driver_code: string; phone: string | null; transport: string | null;
    rating: number; location_shared: boolean; verified?: boolean; verified_at?: string | null;
  } | null;
  position: { latitude: number; longitude: number; recorded_at: string; straight_line_km_to_customer: number | null } | null;
  history: { status: OrderStatus; at: string; note: string | null }[];
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

/** Carte Kin Marché Fidélité (numéro = téléphone du compte, 243 + 9 chiffres). */
export type LoyaltyTier = 'silver' | 'gold' | 'platinum';
export interface LoyaltyCardInfo {
  card_number: string | null;
  card_status: 'none' | 'active' | 'suspended';
  tier: LoyaltyTier | 'none';
  points_balance: number;
  /** Points importés du programme en magasin, bloqués jusqu'à la vérification par Kin Marché. */
  locked_points: number;
  redeemable_points: number;
  lifetime_points: number;
  card_issued_at: string | null;
  tier_changed_at: string | null;
  enrollment_source: 'purchase' | 'program' | 'admin' | null;
  full_name: string | null;
  phone: string | null;
  /** Numéro de carte que donnerait le téléphone du compte (null si le téléphone manque ou n'est pas valide). */
  phone_card_number: string | null;
  phone_card_taken: boolean;
  linked: boolean;
  link_verified: boolean;
  enroll_eligible: boolean;
  enroll_min_cdf: number;
  enroll_min_usd: number | null;
  earn_per_usd: number;
  point_value_usd: number;
  tier_bonus: Partial<Record<LoyaltyTier, number>>;
  program: { name: string; url: string; phone?: string; website?: string };
  /** Vrai quand la base n'a pas encore la carte fidélité (ancienne version du serveur). */
  legacy?: boolean;
}

/** Roue de la chance. */
export type WheelPrizeKind = 'points' | 'coupon_percent' | 'coupon_fixed' | 'product' | 'extra_spin' | 'nothing';

export interface WheelPrize {
  id: string;
  label: string;
  label_i18n: Partial<Record<Language, string>>;
  kind: WheelPrizeKind;
  value: number;
  color: string;
  min_order_usd: number;
  quantity: number;
  /** Chance de gain en pourcentage (affichée en toute transparence). */
  chance: number | null;
  product_name: string | null;
  image_url: string | null;
}

export interface WheelReward {
  id: string;
  kind: WheelPrizeKind;
  label: string;
  points: number | null;
  status: 'pending' | 'attached' | 'delivered' | 'credited' | 'issued' | 'cancelled';
  quantity: number;
  claim_code: string;
  created_at: string;
  note: string | null;
  coupon_code: string | null;
  coupon_ends_at: string | null;
  coupon_min_order_usd: number | null;
  coupon_used: boolean;
  coupon_active: boolean;
  product_name: string | null;
  order_number: string | null;
  image_url: string | null;
}

/** active = jouable maintenant ; off = désactivée ; upcoming = pas encore commencée ; ended = terminée. */
export type WheelState = 'active' | 'off' | 'upcoming' | 'ended';

export interface WheelInfo {
  enabled: boolean;
  state?: WheelState;
  starts_at?: string | null;
  ends_at?: string | null;
  min_order_usd: number;
  spins_per_order: number;
  spin_validity_days: number;
  prizes: WheelPrize[];
  spins_available?: number;
  next_expiry?: string | null;
  rewards?: WheelReward[];
  history?: { used_at: string; label: string; kind: WheelPrizeKind }[];
}

export interface SpinResult {
  prize_id: string;
  kind: WheelPrizeKind;
  label: string;
  value: number;
  reward_id: string | null;
  coupon_code: string | null;
  coupon_ends_at: string | null;
  min_order_usd: number;
  spins_left: number;
}

export interface LoyaltyTransaction {
  id: string;
  type: 'earn' | 'redeem' | 'expire' | 'adjust' | 'refund_reversal';
  points: number;
  note: string | null;
  created_at: string;
  expires_at: string | null;
}

// ---------------------------------------------------------------------
// Pâtisserie : demandes des clients, pâtissiers, discussion
// ---------------------------------------------------------------------
export type PastryCategory = 'cake' | 'bread' | 'viennoiserie' | 'other';
export type PastryStatus =
  | 'submitted' | 'quoted' | 'accepted' | 'rejected' | 'cancelled'
  | 'paid' | 'in_preparation' | 'ready' | 'delivering' | 'delivered';

export interface PastryOrder {
  id: string;
  request_number: string | null;
  customer_id: string;
  store_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  category: PastryCategory;
  cake_type: string;
  size: string | null;
  servings: number | null;
  quantity: number | null;
  flavor: string | null;
  color: string | null;
  inscription: string | null;
  details: string | null;
  reference_photo_path: string | null;
  desired_at: string | null;
  delivery_address: Record<string, unknown> | null;
  status: PastryStatus;
  quoted_price_usd: number | null;
  quote_details: string | null;
  quoted_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  cancelled_at: string | null;
  chef_id: string | null;
  order_id: string | null;
  order_number: string | null;
  order_status: OrderStatus | null;
  created_at: string;
  updated_at: string;
  stores?: { name: string } | null;
}

export interface PastryMessage {
  id: string;
  cake_order_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface PastryChef {
  id: string;
  store_id: string;
  status: 'active' | 'suspended';
  certified: boolean;
  certified_at: string | null;
  display_name: string | null;
  bio: string | null;
  specialties: string[];
  years_experience: number | null;
  birth_date: string | null;
  gender: 'female' | 'male' | 'other' | null;
  nationality: string | null;
  id_type: 'voter_card' | 'passport' | 'driver_license' | 'other' | null;
  id_number: string | null;
  id_photo_path: string | null;
  address: string | null;
  commune: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  profile_completed_at: string | null;
  orders_done: number;
  stores?: { name: string } | null;
}

/** Carte publique d'un pâtissier, vue par le client (jamais l'identité ni le téléphone). */
export interface PastryChefCard {
  id: string;
  name: string | null;
  avatar_url: string | null;
  certified: boolean;
  specialties: string[];
  years_experience: number | null;
  bio: string | null;
  orders_done: number;
}

export interface PastrySettings { enabled: boolean; min_lead_hours: number }
export interface PastryStore { store_id: string; chefs: number; certified: number }
