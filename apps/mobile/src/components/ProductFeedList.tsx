import type { ReactElement } from 'react';
import { Dimensions, FlatList, RefreshControl, View, type StyleProp, type ViewStyle } from 'react-native';
import { useProductFeed, type Feed } from '@/hooks/feed';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';
import { AppFooter } from './AppFooter';
import { BasketLoader } from './BasketLoader';
import { ProductCard } from './product';
import { SectionHeader, T } from './ui';

const GAP = spacing.sm;
const CELL = (Dimensions.get('window').width - spacing.lg * 2 - GAP) / 2;

/**
 * Écran en liste avec, en bas, une grille de produits qui se charge au fil du défilement.
 * Un petit panier animé s'affiche pendant le chargement de la suite ; le pied de page à la fin.
 */
export function ProductFeedList({ feed, header, title, subtitle, onRefresh, refreshing, enabled = true, contentStyle, footer }: {
  feed: Feed;
  header?: ReactElement | null;
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  enabled?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactElement | null;
}) {
  const { colors } = useSettings();
  const q = useProductFeed(feed, enabled);
  const items = q.data?.pages.flat() ?? [];
  const loadingMore = q.isFetchingNextPage || (q.isLoading && enabled);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      data={items}
      numColumns={2}
      keyExtractor={(i) => i.inventory_id}
      columnWrapperStyle={{ gap: GAP, paddingHorizontal: spacing.lg }}
      contentContainerStyle={[{ gap: GAP, paddingBottom: spacing.xl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: spacing.sm }}>
          {header}
          {items.length > 0 ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 2 }}>
              <SectionHeader title={title} />
              {subtitle ? <T size="sm" muted>{subtitle}</T> : null}
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ width: CELL }}>
          <ProductCard item={item} />
        </View>
      )}
      onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }}
      onEndReachedThreshold={0.5}
      refreshControl={onRefresh ? (
        <RefreshControl refreshing={!!refreshing} onRefresh={() => { onRefresh(); q.refetch(); }} tintColor={colors.primary} colors={[colors.primary]} />
      ) : undefined}
      ListFooterComponent={
        <View>
          {loadingMore ? <BasketLoader size="mini" showLabel={false} /> : null}
          {footer}
          {!loadingMore && !q.hasNextPage ? <AppFooter /> : null}
        </View>
      }
    />
  );
}
