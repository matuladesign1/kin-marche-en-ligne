import { Stack, useLocalSearchParams } from 'expo-router';
import { ProductGrid } from '@/components/product';
import { Chip, ErrorState, Loading, Row, Screen } from '@/components/ui';
import { useCatalog, useCategories } from '@/hooks/data';
import { localized } from '@/lib/i18n';
import { useState } from 'react';
import { useSettings } from '@/providers/SettingsProvider';

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language, selectedStoreId } = useSettings();
  const [inStockOnly, setInStockOnly] = useState(false);
  const cats = useCategories();
  const cat = cats.data?.find((c) => c.id === id);
  const q = useCatalog({ categoryId: id, storeId: selectedStoreId, inStockOnly, limit: 100 });

  return (
    <Screen>
      <Stack.Screen options={{ title: cat ? localized(cat.name, language, cat.slug) : t('tab.categories') }} />
      <Row><Chip label={t('search.inStockOnly')} active={inStockOnly} onPress={() => setInStockOnly((v) => !v)} icon="checkmark" /></Row>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState message={t('common.error')} onRetry={q.refetch} /> : (
        <ProductGrid items={q.data ?? []} emptyMessage={t('home.noProducts')} />
      )}
    </Screen>
  );
}
