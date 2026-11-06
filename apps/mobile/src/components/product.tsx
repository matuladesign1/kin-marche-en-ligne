import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useAddToCart } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatQty } from '@/lib/format';
import { localized } from '@/lib/i18n';
import { radius, spacing } from '@/lib/theme';
import type { CatalogItem } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';
import { EmptyState, Row, SectionHeader, T } from './ui';
import { VerifiedBadge } from './VerifiedBadge';

export function useAddToCartFlow() {
  const { session } = useAuth();
  const { t } = useSettings();
  const add = useAddToCart();

  const run = (item: CatalogItem, quantity = item.min_quantity) => {
    if (!session) {
      router.push('/(auth)/sign-in');
      return;
    }
    add.mutate(
      { inventoryId: item.inventory_id, quantity },
      {
        onError: (e) => {
          if ((e as Error).message === 'CART_OTHER_STORE') {
            Alert.alert(t('cart.title'), t('product.otherStore'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.confirm'), style: 'destructive', onPress: () => add.mutate({ inventoryId: item.inventory_id, quantity, replace: true }) },
            ]);
          } else {
            Alert.alert(t('cart.title'), errorMessage(e, t));
          }
        },
      },
    );
  };
  return { run, pending: add.isPending };
}

export function PriceTag({ item, large }: { item: CatalogItem; large?: boolean }) {
  const { money, colors } = useSettings();
  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      <T size={large ? 'xl' : 'md'} weight="700" color={item.on_promo ? colors.primary : colors.text}>
        {money(item.effective_price_usd)}
      </T>
      {item.on_promo ? (
        <T size="xs" muted style={{ textDecorationLine: 'line-through' }}>{money(item.price_usd)}</T>
      ) : null}
    </Row>
  );
}

/** Pourcentage de remise affiché (« -11 % »), 0 sans promotion. */
export function discountPercent(item: CatalogItem): number {
  if (!item.on_promo || !item.price_usd || item.effective_price_usd >= item.price_usd) return 0;
  return Math.round((1 - item.effective_price_usd / item.price_usd) * 100);
}

/**
 * Carte produit : grande photo carrée, badges (PROMO, Produit local), nom, prix avec remise,
 * quantité minimale et ventes, supermarché vérifié. Le bouton panier est sur la photo.
 */
export const ProductCard = memo(function ProductCard({ item, width }: { item: CatalogItem; width?: number }) {
  const { colors, t, language, money } = useSettings();
  const { run, pending } = useAddToCartFlow();
  const name = localized(item.name_i18n, language, item.name);
  const off = discountPercent(item);
  return (
    <Pressable
      onPress={() => router.push(`/product/${item.inventory_id}`)}
      accessibilityLabel={`${name}, ${money(item.effective_price_usd)}`}
      style={({ pressed }) => [styles.card, { width: width ?? '100%', backgroundColor: colors.surface, opacity: pressed ? 0.92 : 1 }]}
    >
      <View style={[styles.imageWrap, { backgroundColor: colors.surfaceAlt }]}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150}
            cachePolicy="memory-disk" recyclingKey={item.inventory_id} accessibilityIgnoresInvertColors />
        ) : (
          <Ionicons name="image-outline" size={40} color={colors.textMuted} />
        )}
        {!item.in_stock ? (
          <View style={styles.soldOut}>
            <T size="sm" weight="700" color="#FFFFFF">{t('product.outOfStock')}</T>
          </View>
        ) : (
          <Pressable
            onPress={() => run(item)}
            disabled={pending}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('product.addToCart')}
            style={[styles.cartBtn, { backgroundColor: colors.surface, opacity: pending ? 0.6 : 1 }]}
          >
            <Ionicons name="cart-outline" size={16} color={colors.primary} />
            <Ionicons name="add" size={10} color={colors.primary} style={styles.cartPlus} />
          </Pressable>
        )}
      </View>
      <View style={styles.body}>
        {item.on_promo || item.is_local ? (
          <Row gap={4} style={{ flexWrap: 'wrap' }}>
            {item.on_promo ? (
              <View style={[styles.tag, { backgroundColor: colors.primary }]}>
                <T size="xs" weight="800" color={colors.onPrimary}>{t('product.promo').toUpperCase()}</T>
              </View>
            ) : null}
            {item.is_local ? (
              <View style={[styles.tag, styles.tagOutline, { borderColor: colors.success }]}>
                <Ionicons name="leaf" size={10} color={colors.success} />
                <T size="xs" weight="700" color={colors.success}>{t('product.localBadge')}</T>
              </View>
            ) : null}
          </Row>
        ) : null}
        <T size="sm" numberOfLines={1}>{name}</T>
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          <T size="lg" weight="800" style={{ fontSize: 16 }}>{money(item.effective_price_usd)}</T>
          {off > 0 ? (
            <Row gap={1}>
              <Ionicons name="arrow-down" size={12} color={colors.danger} />
              <T size="xs" weight="700" color={colors.danger}>-{off} %</T>
            </Row>
          ) : null}
        </Row>
        <T size="xs" muted numberOfLines={1}>
          {off > 0 ? <><T size="xs" muted style={{ textDecorationLine: 'line-through' }}>{money(item.price_usd)}</T>{' · '}</> : null}
          {t('product.minShort', { qty: formatQty(Number(item.min_quantity), item.unit, t) })}
          {item.sold_count > 0 ? ` · ${t('product.soldCount', { n: item.sold_count })}` : ''}
        </T>
        <Row gap={4}>
          <VerifiedBadge size={13} color={colors.accent} />
          <T size="xs" weight="600" muted numberOfLines={1} style={{ flexShrink: 1 }}>
            {item.store_name}{item.store_commune ? ` · ${item.store_commune}` : ''}
          </T>
        </Row>
      </View>
    </Pressable>
  );
});

export function ProductRail({ title, items, onSeeAll }: { title: string; items: CatalogItem[] | undefined; onSeeAll?: () => void }) {
  const { t } = useSettings();
  if (!items || items.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title={title} action={onSeeAll ? t('common.seeAll') : undefined} onAction={onSeeAll} />
      <FlatList
        horizontal
        data={items}
        keyExtractor={(i) => i.inventory_id}
        renderItem={({ item }) => <ProductCard item={item} width={160} />}
        ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

export function ProductGrid({ items, emptyMessage }: { items: CatalogItem[]; emptyMessage: string }) {
  if (items.length === 0) return <EmptyState message={emptyMessage} icon="search-outline" />;
  return (
    <View style={styles.grid}>
      {items.map((i) => (
        <View key={i.inventory_id} style={styles.gridCell}>
          <ProductCard item={i} />
        </View>
      ))}
    </View>
  );
}

export function QuantityStepper({ value, step, min, max, onChange, disabled }: {
  value: number; step: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  const { colors } = useSettings();
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return (
    <Row gap={0} style={[styles.stepper, { borderColor: colors.border }]}>
      <Pressable
        accessibilityLabel="-"
        disabled={disabled}
        onPress={() => onChange(round(value - step < min ? 0 : value - step))}
        style={styles.stepBtn}
      >
        <Ionicons name={value - step < min ? 'trash-outline' : 'remove'} size={18} color={colors.text} />
      </Pressable>
      <T weight="700" style={{ minWidth: 36, textAlign: 'center' }}>{value}</T>
      <Pressable
        accessibilityLabel="+"
        disabled={disabled || value + step > max}
        onPress={() => onChange(round(value + step))}
        style={[styles.stepBtn, { opacity: value + step > max ? 0.3 : 1 }]}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </Row>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, overflow: 'hidden', flexGrow: 1 },
  imageWrap: { aspectRatio: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing.sm, paddingTop: 6, paddingBottom: 10, gap: 3 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  tagOutline: { borderWidth: 1, backgroundColor: 'transparent' },
  soldOut: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 6, alignItems: 'center', backgroundColor: 'rgba(22,24,29,0.72)' },
  cartBtn: {
    position: 'absolute', right: 7, bottom: 7, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  cartPlus: { position: 'absolute', top: 5, right: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  gridCell: { width: '50%', padding: spacing.xs },
  stepper: { borderWidth: 1, borderRadius: radius.pill },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
