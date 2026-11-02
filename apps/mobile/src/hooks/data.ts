import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import type {
  Address, AppNotification, CatalogItem, Category, Order, OrderItem, Quote, RecommendedStore, Store, Tracking,
} from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

export const qk = {
  categories: ['categories'] as const,
  catalog: (args: object) => ['catalog', args] as const,
  item: (inventoryId: string) => ['catalog-item', inventoryId] as const,
  stores: ['stores'] as const,
  recommend: (args: object) => ['recommend', args] as const,
  cart: ['cart'] as const,
  addresses: ['addresses'] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['order', id] as const,
  tracking: (id: string) => ['tracking', id] as const,
  favorites: ['favorites'] as const,
  loyalty: ['loyalty'] as const,
  notifications: ['notifications'] as const,
};

export interface CatalogArgs {
  query?: string | null;
  categoryId?: string | null;
  storeId?: string | null;
  inStockOnly?: boolean;
  limit?: number;
}

export function useCatalog(args: CatalogArgs, enabled = true) {
  return useQuery({
    queryKey: qk.catalog(args),
    enabled,
    queryFn: async () =>
      unwrap(await supabase.rpc('search_catalog', {
        p_query: args.query ?? null,
        p_category_id: args.categoryId ?? null,
        p_store_id: args.storeId ?? null,
        p_in_stock_only: args.inStockOnly ?? false,
        p_limit: args.limit ?? 40,
        p_offset: 0,
      })) as CatalogItem[],
  });
}

/** Sections de l'accueil, triées côté base. */
export function useHomeSection(kind: 'best' | 'new' | 'promo' | 'featured' | 'local', storeId: string | null) {
  return useQuery({
    queryKey: ['home', kind, storeId],
    queryFn: async () => {
      let q = supabase.from('catalog_items').select('*').eq('in_stock', true).limit(12);
      if (storeId) q = q.eq('store_id', storeId);
      if (kind === 'best') q = q.order('sold_count', { ascending: false });
      if (kind === 'new') q = q.order('created_at', { ascending: false });
      if (kind === 'promo') q = q.eq('on_promo', true).order('sold_count', { ascending: false });
      if (kind === 'featured') q = q.eq('is_featured', true);
      if (kind === 'local') q = q.eq('is_local', true);
      return unwrap(await q) as CatalogItem[];
    },
  });
}

export function useCatalogItem(inventoryId: string) {
  return useQuery({
    queryKey: qk.item(inventoryId),
    queryFn: async () => {
      const item = unwrap(await supabase.from('catalog_items').select('*').eq('inventory_id', inventoryId).maybeSingle()) as CatalogItem | null;
      if (!item) return null;
      const [product, images, others, reviews] = await Promise.all([
        supabase.from('products').select('description, description_i18n, specs, nutrition, allergens, storage_conditions').eq('id', item.product_id).maybeSingle(),
        supabase.from('product_images').select('url, alt').eq('product_id', item.product_id).order('sort_order'),
        supabase.from('catalog_items').select('inventory_id, store_id, store_name, effective_price_usd, in_stock').eq('product_id', item.product_id),
        supabase.from('reviews').select('id, rating, comment, created_at').eq('product_id', item.product_id).eq('status', 'approved').order('created_at', { ascending: false }).limit(10),
      ]);
      return {
        item,
        details: product.data as { description: string | null; allergens: string[] | null; storage_conditions: string | null } | null,
        images: (images.data ?? []) as { url: string; alt: string | null }[],
        otherStores: (others.data ?? []) as Pick<CatalogItem, 'inventory_id' | 'store_id' | 'store_name' | 'effective_price_usd' | 'in_stock'>[],
        reviews: (reviews.data ?? []) as { id: string; rating: number; comment: string | null; created_at: string }[],
      };
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      unwrap(await supabase.from('product_categories').select('id, slug, name, icon, image_url, parent_id, sort_order').order('sort_order')) as Category[],
  });
}

export function useStores() {
  return useQuery({
    queryKey: qk.stores,
    queryFn: async () => unwrap(await supabase.from('stores').select('*').order('name')) as Store[],
  });
}

export function useRecommendedStores(args: { lat?: number | null; lng?: number | null; commune?: string | null; productIds?: string[] | null }) {
  return useQuery({
    queryKey: qk.recommend(args),
    queryFn: async () =>
      unwrap(await supabase.rpc('recommend_stores', {
        p_lat: args.lat ?? null, p_lng: args.lng ?? null, p_commune: args.commune ?? null, p_product_ids: args.productIds ?? null,
      })) as RecommendedStore[],
  });
}

export interface CartLine {
  id: string;
  quantity: number;
  inventory_id: string;
  item: CatalogItem | null;
}

export function useCart() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.cart,
    enabled: !!session,
    queryFn: async () => {
      const cart = unwrap(await supabase.from('carts').select('id, store_id').maybeSingle()) as { id: string; store_id: string | null } | null;
      if (!cart) return { cartId: null, storeId: null, lines: [] as CartLine[] };
      const items = unwrap(await supabase.from('cart_items').select('id, quantity, inventory_id').eq('cart_id', cart.id).order('created_at')) as
        { id: string; quantity: number; inventory_id: string }[];
      const ids = items.map((i) => i.inventory_id);
      const catalog = ids.length
        ? (unwrap(await supabase.from('catalog_items').select('*').in('inventory_id', ids)) as CatalogItem[])
        : [];
      const lines: CartLine[] = items.map((i) => ({ ...i, quantity: Number(i.quantity), item: catalog.find((c) => c.inventory_id === i.inventory_id) ?? null }));
      return { cartId: cart.id, storeId: cart.store_id, lines };
    },
  });
}

export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { inventoryId: string; quantity: number; replace?: boolean }) =>
      unwrap(await supabase.rpc('add_to_cart', { p_inventory_id: args.inventoryId, p_quantity: args.quantity, p_replace_cart: args.replace ?? false })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.cart }),
  });
}

export function useSetCartQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { inventoryId: string; quantity: number }) =>
      unwrap(await supabase.rpc('set_cart_quantity', { p_inventory_id: args.inventoryId, p_quantity: args.quantity })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.cart }),
  });
}

export function useAddresses() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.addresses,
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.from('addresses').select('*').order('is_default', { ascending: false }).order('created_at')) as Address[],
  });
}

export function useQuote(args: { addressId: string | null; coupon: string | null; points: number }, enabled: boolean) {
  return useQuery({
    queryKey: ['quote', args],
    enabled,
    queryFn: async () =>
      unwrap(await supabase.rpc('quote_order', { p_address_id: args.addressId, p_coupon_code: args.coupon, p_points: args.points })) as Quote,
  });
}

export function useOrders() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.orders,
    enabled: !!session,
    queryFn: async () =>
      unwrap(await supabase.from('orders').select('*, stores(name)').eq('customer_id', session!.user.id).order('created_at', { ascending: false }).limit(100)) as Order[],
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: qk.order(id),
    queryFn: async () => {
      const [order, items, otp, tracking] = await Promise.all([
        supabase.from('orders').select('*, stores(name)').eq('id', id).maybeSingle(),
        supabase.from('order_items').select('*').eq('order_id', id),
        supabase.from('delivery_otps').select('code, verified_at').eq('order_id', id).maybeSingle(),
        supabase.rpc('get_order_tracking', { p_order_id: id }),
      ]);
      return {
        order: unwrap(order) as Order | null,
        items: (items.data ?? []) as OrderItem[],
        otp: otp.data as { code: string; verified_at: string | null } | null,
        tracking: (tracking.data ?? null) as Tracking | null,
      };
    },
  });
}

export function useFavorites() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.favorites,
    enabled: !!session,
    queryFn: async () => (unwrap(await supabase.from('favorites').select('product_id')) as { product_id: string }[]).map((f) => f.product_id),
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ productId, isFavorite }: { productId: string; isFavorite: boolean }) => {
      if (isFavorite) unwrap(await supabase.from('favorites').delete().eq('product_id', productId));
      else unwrap(await supabase.from('favorites').insert({ product_id: productId, user_id: session!.user.id }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.favorites }),
  });
}

export function useLoyalty() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.loyalty,
    enabled: !!session,
    queryFn: async () => {
      const [acc, tx] = await Promise.all([
        supabase.from('loyalty_accounts').select('points_balance, lifetime_points, tier').maybeSingle(),
        supabase.from('loyalty_transactions').select('id, type, points, note, created_at, expires_at').order('created_at', { ascending: false }).limit(50),
      ]);
      return {
        account: (acc.data ?? { points_balance: 0, lifetime_points: 0, tier: 'bronze' }) as { points_balance: number; lifetime_points: number; tier: string },
        history: (tx.data ?? []) as { id: string; type: string; points: number; note: string | null; created_at: string; expires_at: string | null }[],
      };
    },
  });
}

export function useNotifications() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.notifications,
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) as AppNotification[],
  });
}
