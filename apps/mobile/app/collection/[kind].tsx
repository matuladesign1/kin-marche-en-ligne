import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { ProductFeedList } from '@/components/ProductFeedList';
import { isFeedFilter } from '@/hooks/feed';
import { useSettings } from '@/providers/SettingsProvider';

/** Collection de produits : meilleures ventes, promotions, nouveautés, recommandés, produits locaux. */
export default function Collection() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const { t, colors, selectedStoreId } = useSettings();
  const filter = isFeedFilter(kind) ? kind : 'all';
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t(`collection.${filter}`) }} />
      <ProductFeedList
        feed={{ kind: 'all', storeId: selectedStoreId, filter }}
        header={<View style={{ height: 8 }} />}
        emptyMessage={t('home.noProducts')}
      />
    </View>
  );
}
