import { useQuery } from '@tanstack/react-query';
import { ProductGrid } from '@/components/product';
import { Loading, Screen } from '@/components/ui';
import { useFavorites } from '@/hooks/data';
import { supabase, unwrap } from '@/lib/supabase';
import type { CatalogItem } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

export default function Favorites() {
  const { t, selectedStoreId } = useSettings();
  const favs = useFavorites();
  const items = useQuery({
    queryKey: ['favorite-items', favs.data, selectedStoreId],
    enabled: !!favs.data,
    queryFn: async () => {
      if (!favs.data?.length) return [] as CatalogItem[];
      let q = supabase.from('catalog_items').select('*').in('product_id', favs.data);
      if (selectedStoreId) q = q.eq('store_id', selectedStoreId);
      const rows = unwrap(await q) as CatalogItem[];
      // Un exemplaire par produit : en priorité celui qui est en stock.
      const best = new Map<string, CatalogItem>();
      for (const r of rows) {
        const cur = best.get(r.product_id);
        if (!cur || (!cur.in_stock && r.in_stock)) best.set(r.product_id, r);
      }
      return [...best.values()];
    },
  });
  if (favs.isLoading || items.isLoading) return <Loading />;
  return (
    <Screen>
      <ProductGrid items={items.data ?? []} emptyMessage={t('favorites.empty')} />
    </Screen>
  );
}
