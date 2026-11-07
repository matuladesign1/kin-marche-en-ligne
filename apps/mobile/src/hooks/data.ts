import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { cardNumberFromPhone } from '@/lib/loyalty';
import { CUSTOMER_ONLY_KINDS } from '@/lib/notify';
import { countOrderTabs } from '@/lib/orders';
import { readRecent } from '@/lib/recent';
import type {
  Address, AppNotification, CatalogItem, Category, LoyaltyCardInfo, LoyaltyTransaction, Order, OrderItem, Quote,
  RecommendedStore, SpinResult, Store, Tracking, WheelInfo,
} from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

export const qk = {
  unread: ['unread'] as const,
  wheel: ['wheel'] as const,
  wheelPublic: ['wheel-public'] as const,
  myCoupons: ['my-coupons'] as const,
  ordersToReview: ['orders-to-review'] as const,
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
        supabase.from('products').select('description, description_i18n, specs, nutrition, allergens, storage_conditions, recommend_count').eq('id', item.product_id).maybeSingle(),
        supabase.from('product_images').select('url, alt').eq('product_id', item.product_id).order('sort_order'),
        supabase.from('catalog_items').select('inventory_id, store_id, store_name, effective_price_usd, in_stock').eq('product_id', item.product_id),
        supabase.from('reviews').select('id, rating, comment, created_at').eq('product_id', item.product_id).eq('target_type', 'product').eq('status', 'approved').order('created_at', { ascending: false }).limit(30),
      ]);
      return {
        item,
        details: product.data as {
          description: string | null; description_i18n: Partial<Record<string, string>> | null; specs: Record<string, unknown> | null;
          nutrition: Record<string, unknown> | null; allergens: string[] | null; storage_conditions: string | null; recommend_count: number;
        } | null,
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
    // Nouvelle position : on garde la liste affichée pendant le recalcul (pas d'écran de chargement).
    placeholderData: (previous) => previous,
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

/** Carte Kin Marché Fidélité de l'utilisateur et historique des points. */
export function useLoyalty() {
  const { session, profile } = useAuth();
  return useQuery({
    queryKey: qk.loyalty,
    enabled: !!session,
    queryFn: async () => {
      const [card, tx] = await Promise.all([
        supabase.rpc('get_my_loyalty_card'),
        supabase.from('loyalty_transactions').select('id, type, points, note, created_at, expires_at')
          .neq('points', 0).order('created_at', { ascending: false }).limit(50),
      ]);
      let info: LoyaltyCardInfo;
      if (card.error) {
        // Serveur pas encore à jour : l'ancien solde reste visible, sans carte.
        if (card.error.code !== 'PGRST202' && !/get_my_loyalty_card/.test(card.error.message ?? '')) throw card.error;
        const acc = await supabase.from('loyalty_accounts').select('points_balance, lifetime_points').maybeSingle();
        info = legacyCard(acc.data, profile?.full_name ?? null, profile?.phone ?? null);
      } else {
        info = card.data as LoyaltyCardInfo;
      }
      return { card: info, history: (tx.data ?? []) as LoyaltyTransaction[] };
    },
  });
}

function legacyCard(acc: { points_balance: number; lifetime_points: number } | null, name: string | null, phone: string | null): LoyaltyCardInfo {
  return {
    card_number: null, card_status: 'none', tier: 'none',
    points_balance: acc?.points_balance ?? 0, locked_points: 0, redeemable_points: acc?.points_balance ?? 0,
    lifetime_points: acc?.lifetime_points ?? 0, card_issued_at: null, tier_changed_at: null, enrollment_source: null,
    full_name: name, phone, phone_card_number: cardNumberFromPhone(phone), phone_card_taken: false,
    linked: false, link_verified: false, enroll_eligible: false, enroll_min_cdf: 16000, enroll_min_usd: null,
    earn_per_usd: 1, point_value_usd: 0.01, tier_bonus: { silver: 0, gold: 0.1, platinum: 0.25 },
    program: { name: 'Kin Marché Fidélité', url: 'https://loyalty.kinmarche.com/login' }, legacy: true,
  };
}

/** « Je suis déjà membre » : relance la recherche de la carte avec le téléphone du compte. */
export function useLinkLoyaltyCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('link_my_loyalty_card')) as LoyaltyCardInfo & { found: boolean },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.loyalty }),
  });
}

/** Filtre des espaces livreur et pâtissier : ils ne voient pas les notifications de client. */
const NOT_FOR_DRIVER = `(${CUSTOMER_ONLY_KINDS.join(',')})`;

export function useNotifications() {
  const { session, profile } = useAuth();
  const driver = profile?.role === 'driver' || profile?.role === 'pastry_chef';
  return useQuery({
    queryKey: qk.notifications,
    enabled: !!session,
    queryFn: async () => {
      let q = supabase.from('notifications').select('*');
      if (driver) q = q.not('kind', 'in', NOT_FOR_DRIVER);
      return unwrap(await q.order('created_at', { ascending: false }).limit(100)) as AppNotification[];
    },
  });
}

/** Non lus : notifications + messages de l'assistance (pastille de l'onglet « Messages »). */
export function useUnreadCount() {
  const { session, profile } = useAuth();
  const driver = profile?.role === 'driver' || profile?.role === 'pastry_chef';
  return useQuery({
    queryKey: qk.unread,
    enabled: !!session,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [notes, messages] = await Promise.all([
        driver
          ? supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).not('kind', 'in', NOT_FOR_DRIVER)
          : supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
        supabase.from('messages').select('id', { count: 'exact', head: true }).is('read_at', null).neq('sender_id', session!.user.id),
      ]);
      return { notifications: notes.count ?? 0, messages: messages.count ?? 0, total: (notes.count ?? 0) + (messages.count ?? 0) };
    },
  });
}

/** Marque des notifications comme lues (toutes si ids est omis). */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).eq('user_id', session!.user.id);
      if (ids?.length) q = q.in('id', ids);
      unwrap(await q);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.unread });
    },
  });
}

/** Supprime des notifications du client (disparition immédiate de la liste, rétablie en cas d'erreur). */
export function useDeleteNotifications() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      unwrap(await supabase.from('notifications').delete().eq('user_id', session!.user.id).in('id', ids));
    },
    onMutate: async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<AppNotification[]>(qk.notifications);
      if (prev) qc.setQueryData<AppNotification[]>(qk.notifications, prev.filter((n) => !ids.includes(n.id)));
      return { prev };
    },
    onError: (_e, _ids, ctx) => { if (ctx?.prev) qc.setQueryData(qk.notifications, ctx.prev); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.unread });
    },
  });
}

/** Roue de la chance : règles et lots (visiteur) ou données complètes (client connecté). */
export function useWheel() {
  const { session } = useAuth();
  return useQuery({
    queryKey: session ? qk.wheel : qk.wheelPublic,
    queryFn: async () => {
      const res = session ? await supabase.rpc('get_my_wheel') : await supabase.rpc('get_wheel_public');
      if (res.error) {
        // Serveur pas encore à jour : la roue est simplement masquée.
        if (res.error.code === 'PGRST202' || /get_(my_)?wheel/.test(res.error.message ?? '')) return null;
        throw res.error;
      }
      return res.data as WheelInfo;
    },
  });
}

export function useSpinWheel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('spin_wheel')) as SpinResult,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.wheel });
      qc.invalidateQueries({ queryKey: qk.loyalty });
      qc.invalidateQueries({ queryKey: qk.myCoupons });
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.unread });
    },
  });
}

export interface CouponRow {
  id: string; code: string; description: string | null; discount_type: 'percent' | 'fixed'; discount_value: number;
  min_order_usd: number; ends_at: string | null; is_public: boolean; used_count: number; usage_limit: number | null;
}

/** Codes promo : publics en cours + codes personnels (Roue de la chance) encore utilisables. */
export function useMyCoupons() {
  const { session } = useAuth();
  return useQuery({
    queryKey: [...qk.myCoupons, session?.user.id ?? 'guest'],
    queryFn: async () => {
      // La RLS ne renvoie que les codes publics et ceux réservés à ce client.
      const rows = unwrap(await supabase.from('coupons')
        .select('id, code, description, discount_type, discount_value, min_order_usd, ends_at, is_public, used_count, usage_limit')
        .eq('is_active', true)
        .order('ends_at', { ascending: true, nullsFirst: false })) as CouponRow[];
      const now = Date.now();
      return rows.filter((c) => (c.ends_at == null || Date.parse(c.ends_at) > now)
        && (c.usage_limit == null || c.used_count < c.usage_limit));
    },
  });
}

/** Articles vus récemment (relu à chaque affichage de l'écran). */
export function useRecentItems(limit = 20) {
  const [ids, setIds] = useState<string[] | null>(null);
  useFocusEffect(useCallback(() => { readRecent().then(setIds); }, []));
  const q = useQuery({
    queryKey: ['recent-items', ids?.slice(0, limit)],
    enabled: !!ids && ids.length > 0,
    queryFn: async () => {
      const wanted = ids!.slice(0, limit);
      const items = unwrap(await supabase.from('catalog_items').select('*').in('inventory_id', wanted)) as CatalogItem[];
      return wanted.map((id) => items.find((i) => i.inventory_id === id)).filter((i): i is CatalogItem => !!i);
    },
  });
  return { items: ids && ids.length === 0 ? [] : q.data, isLoading: ids === null || q.isLoading, refresh: () => readRecent().then(setIds) };
}

export interface CategoryTeaser { categoryId: string; image: string | null; fromPrice: number; count: number }

/** Vignettes « Explorez … » : la meilleure vente de chaque rayon et son prix de départ. */
export function useCategoryTeasers(storeId: string | null) {
  const cats = useCategories();
  return useQuery({
    queryKey: ['category-teasers', storeId, cats.data?.length ?? 0],
    enabled: !!cats.data,
    queryFn: async () => {
      let q = supabase.from('catalog_items').select('category_id, image_url, effective_price_usd, sold_count')
        .eq('in_stock', true).not('category_id', 'is', null).order('sold_count', { ascending: false }).limit(400);
      if (storeId) q = q.eq('store_id', storeId);
      const rows = unwrap(await q) as { category_id: string; image_url: string | null; effective_price_usd: number }[];
      const parent = new Map<string, string>((cats.data ?? []).map((c): [string, string] => [c.id, c.parent_id ?? c.id]));
      const byCat = new Map<string, CategoryTeaser>();
      for (const r of rows) {
        const top = parent.get(r.category_id) ?? r.category_id;
        const cur = byCat.get(top);
        if (!cur) byCat.set(top, { categoryId: top, image: r.image_url, fromPrice: Number(r.effective_price_usd), count: 1 });
        else {
          cur.count += 1;
          cur.fromPrice = Math.min(cur.fromPrice, Number(r.effective_price_usd));
          if (!cur.image && r.image_url) cur.image = r.image_url;
        }
      }
      return [...byCat.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    },
  });
}

/** Compteurs des rubriques « Mes commandes » (paiement en attente, envoi, réception, remboursement, avis). */
export function useOrderCounts() {
  const { session } = useAuth();
  const orders = useOrders();
  const toReview = useQuery({
    queryKey: qk.ordersToReview,
    enabled: !!session,
    queryFn: async () => new Set(((await supabase.rpc('orders_awaiting_review')).data ?? []) as string[]),
  });
  return { counts: countOrderTabs(orders.data ?? [], toReview.data ?? new Set<string>()), isLoading: orders.isLoading };
}

/** Image du dernier favori (carte « Favoris » du compte). */
export function useFavoritePreview() {
  const favorites = useFavorites();
  const first = favorites.data?.[0] ?? null;
  const img = useQuery({
    queryKey: ['favorite-preview', first],
    enabled: !!first,
    queryFn: async () => ((await supabase.from('catalog_items').select('image_url').eq('product_id', first!).not('image_url', 'is', null).limit(1)).data?.[0]?.image_url ?? null) as string | null,
  });
  return { count: favorites.data?.length ?? 0, image: img.data ?? null };
}

/** Dernière version publiée de l'application (APK de test sur GitHub). */
export function useAppUpdate(currentBuild: number | null) {
  return useQuery({
    queryKey: ['app-update', currentBuild],
    staleTime: 6 * 60 * 60_000,
    retry: 0,
    queryFn: async () => {
      const res = await fetch('https://api.github.com/repos/matuladesign1/kin-marche-en-ligne/releases?per_page=10', {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return null;
      const list = (await res.json()) as { tag_name: string; html_url: string; assets?: { name: string; size: number; browser_download_url: string }[] }[];
      const builds = list
        .map((r) => ({ build: Number(/^apk-(\d+)$/.exec(r.tag_name)?.[1]), r }))
        .filter((x) => Number.isFinite(x.build))
        .sort((a, b) => b.build - a.build);
      const latest = builds[0];
      if (!latest) return null;
      const apk = latest.r.assets?.find((a) => a.name.endsWith('.apk'));
      return {
        build: latest.build, url: apk?.browser_download_url ?? latest.r.html_url, newer: currentBuild != null && latest.build > currentBuild,
        /** Fichier APK direct (téléchargement dans l'application) et sa taille en octets. */
        apkUrl: apk?.browser_download_url ?? null, size: apk?.size ?? 0,
      };
    },
  });
}

/** Taux de la taxe sur les achats (TVA réglée par l'administrateur général ; 0 si elle est désactivée). */
export function useTaxRate() {
  return useQuery({
    queryKey: ['tax-setting'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'tax').maybeSingle();
      const v = (data?.value ?? {}) as { enabled?: boolean; rate?: number | string };
      return v.enabled ? Math.min(Math.max(Number(v.rate ?? 0), 0), 100) : 0;
    },
  });
}
