export type AppRole = 'customer' | 'store_admin' | 'driver' | 'super_admin' | 'agent';
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

export interface WheelInfo {
  enabled: boolean;
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
