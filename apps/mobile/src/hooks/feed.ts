import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import type { CatalogItem } from '@/lib/types';

export type Feed =
  | { kind: 'all'; storeId?: string | null }
  | { kind: 'featured' }
  | { kind: 'recent' }
  | { kind: 'similar'; productId: string; categoryId: string | null; storeId?: string | null };

export const FEED_PAGE = 20;

/** Produits du catalogue page par page (défilement infini, sans bouton « voir plus »). */
export function useProductFeed(feed: Feed, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['feed', feed],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('catalog_items').select('*');
      switch (feed.kind) {
        case 'all':
          if (feed.storeId) q = q.eq('store_id', feed.storeId);
          q = q.order('in_stock', { ascending: false }).order('sold_count', { ascending: false }).order('name');
          break;
        case 'featured':
          q = q.eq('is_featured', true).order('in_stock', { ascending: false }).order('sold_count', { ascending: false });
          break;
        case 'recent':
          q = q.order('created_at', { ascending: false });
          break;
        case 'similar':
          q = q.neq('product_id', feed.productId);
          if (feed.categoryId) q = q.eq('category_id', feed.categoryId);
          else if (feed.storeId) q = q.eq('store_id', feed.storeId);
          q = q.order('in_stock', { ascending: false }).order('sold_count', { ascending: false });
          break;
      }
      q = q.order('inventory_id').range(pageParam, pageParam + FEED_PAGE - 1);
      return unwrap(await q) as CatalogItem[];
    },
    getNextPageParam: (last, all) => (last.length < FEED_PAGE ? undefined : all.length * FEED_PAGE),
  });
}
