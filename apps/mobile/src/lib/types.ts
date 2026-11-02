export type AppRole = 'customer' | 'store_admin' | 'driver' | 'super_admin';
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
}

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
  assignment: { id: string; status: string; accepted_at: string | null; picked_up_at: string | null; delivered_at: string | null; eta_minutes: number | null; route_distance_km: number | null; eta_updated_at: string | null; eta_target: 'store' | 'customer' | null } | null;
  driver: { name: string | null; avatar_url: string | null; driver_code: string; phone: string | null; transport: string | null; rating: number; location_shared: boolean } | null;
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
