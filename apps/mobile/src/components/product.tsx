import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useAddToCart } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { localized } from '@/lib/i18n';
import { radius, spacing } from '@/lib/theme';
import type { CatalogItem } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';
import { EmptyState, Row, SectionHeader, T } from './ui';

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

export function ProductCard({ item, width }: { item: CatalogItem; width?: number }) {
  const { colors, t, language } = useSettings();
  const { run, pending } = useAddToCartFlow();
  const name = localized(item.name_i18n, language, item.name);
  return (
    <Pressable
      onPress={() => router.push(`/product/${item.inventory_id}`)}
      accessibilityLabel={name}
      style={({ pressed }) => [styles.card, { width: width ?? '100%', backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.9 : 1 }]}
    >
      <View style={[styles.imageWrap, { backgroundColor: colors.surfaceAlt }]}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityIgnoresInvertColors />
        ) : (
          <Ionicons name="image-outline" size={36} color={colors.textMuted} />
        )}
        {item.on_promo ? (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <T size="xs" weight="700" color={colors.onPrimary}>{t('product.promo')}</T>
          </View>
        ) : null}
      </View>
      <View style={{ padding: spacing.sm, gap: 4, flex: 1 }}>
        <T size="sm" weight="600" numberOfLines={2}>{name}</T>
        <T size="xs" muted numberOfLines={1}>{item.store_name}</T>
        <PriceTag item={item} />
        <View style={{ flex: 1 }} />
        {item.in_stock ? (
          <Pressable
            onPress={() => run(item)}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel={t('product.addToCart')}
            style={[styles.add, { backgroundColor: colors.primary, opacity: pending ? 0.6 : 1 }]}
          >
            <Ionicons name="add" size={18} color={colors.onPrimary} />
            <T size="sm" weight="600" color={colors.onPrimary}>{t('product.addToCart')}</T>
          </Pressable>
        ) : (
          <View style={[styles.add, { backgroundColor: colors.surfaceAlt }]}>
            <T size="sm" muted>{t('product.outOfStock')}</T>
          </View>
        )}
      </View>
    </Pressable>
  );
}

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
  card: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden', minHeight: 270 },
  imageWrap: { height: 120, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, left: 8, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md, minHeight: 36 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  gridCell: { width: '50%', padding: spacing.xs },
  stepper: { borderWidth: 1, borderRadius: radius.pill },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
