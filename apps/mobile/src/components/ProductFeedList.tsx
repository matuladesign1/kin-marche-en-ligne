import { useCallback, type ReactElement } from 'react';
import { Dimensions, FlatList, Platform, RefreshControl, View, type ListRenderItem, type StyleProp, type ViewStyle } from 'react-native';
import { useProductFeed, type Feed } from '@/hooks/feed';
import type { CatalogItem } from '@/lib/types';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';
import { AppFooter } from './AppFooter';
import { BasketLoader } from './BasketLoader';
import { ProductCard } from './product';
import { EmptyState, SectionHeader, T } from './ui';

const GAP = spacing.sm;
const SIDE = spacing.md;
const CELL = (Dimensions.get('window').width - SIDE * 2 - GAP) / 2;

/**
 * Écran en liste avec, en bas, une grille de produits qui se charge au fil du défilement.
 * Un petit panier animé s'affiche pendant le chargement de la suite ; le pied de page à la fin.
 */
export function ProductFeedList({ feed, header, title, subtitle, onRefresh, refreshing, enabled = true, contentStyle, footer, emptyMessage }: {
  feed: Feed;
  header?: ReactElement | null;
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  enabled?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactElement | null;
  emptyMessage?: string;
}) {
  const { colors } = useSettings();
  const q = useProductFeed(feed, enabled);
  const items = q.data?.pages.flat() ?? [];
  const loadingMore = q.isFetchingNextPage || (q.isLoading && enabled);
  // Rendu stable : les cartes déjà affichées ne sont pas recalculées pendant le défilement.
  const renderItem = useCallback<ListRenderItem<CatalogItem>>(({ item }) => (
    <View style={{ width: CELL }}>
      <ProductCard item={item} />
    </View>
  ), []);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      data={items}
      numColumns={2}
      keyExtractor={(i) => i.inventory_id}
      columnWrapperStyle={{ gap: GAP, paddingHorizontal: SIDE }}
      contentContainerStyle={[{ gap: GAP, paddingBottom: spacing.xl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: spacing.sm }}>
          {header}
          {items.length > 0 && title ? (
            <View style={{ paddingHorizontal: SIDE, paddingTop: spacing.md, gap: 2 }}>
              <SectionHeader title={title} />
              {subtitle ? <T size="sm" muted>{subtitle}</T> : null}
            </View>
          ) : null}
        </View>
      }
      renderItem={renderItem}
      // Téléphones modestes : peu de cartes rendues à la fois, celles hors écran sont libérées.
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }}
      onEndReachedThreshold={0.5}
      refreshControl={onRefresh ? (
        <RefreshControl refreshing={!!refreshing} onRefresh={() => { onRefresh(); q.refetch(); }} tintColor={colors.primary} colors={[colors.primary]} />
      ) : undefined}
      ListEmptyComponent={!q.isLoading && enabled && emptyMessage ? <EmptyState icon="storefront-outline" message={emptyMessage} /> : null}
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
