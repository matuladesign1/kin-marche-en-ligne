import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Dimensions, FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PriceTag, QuantityStepper, useAddToCartFlow } from '@/components/product';
import { ProductFeedList } from '@/components/ProductFeedList';
import { Stars } from '@/components/Stars';
import { Button, Card, Divider, ErrorState, Loading, Row, SectionHeader, T } from '@/components/ui';
import { useCatalogItem, useFavorites, useToggleFavorite } from '@/hooks/data';
import { useRecommendation, useReviewableOrder } from '@/hooks/social';
import { formatDate, formatQty } from '@/lib/format';
import { localized } from '@/lib/i18n';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const W = Dimensions.get('window').width;

function SpecRow({ label, value }: { label: string; value: string }) {
  const { colors } = useSettings();
  return (
    <Row style={[styles.specRow, { borderBottomColor: colors.border }]}>
      <T size="sm" muted style={{ width: '42%' }}>{label}</T>
      <T size="sm" weight="600" style={{ flex: 1 }}>{value}</T>
    </Row>
  );
}

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language, colors, money } = useSettings();
  const { session } = useAuth();
  const q = useCatalogItem(id);
  const favs = useFavorites();
  const toggleFav = useToggleFavorite();
  const { run, pending } = useAddToCartFlow();
  const [qty, setQty] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);
  const productId = q.data?.item.product_id;
  const reco = useRecommendation(productId);
  const reviewable = useReviewableOrder(productId);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={t('common.error')} onRetry={q.refetch} />;
  const { item, details, images, otherStores, reviews } = q.data;
  const name = localized(item.name_i18n, language, item.name);
  const description = localized(details?.description_i18n ?? undefined, language, details?.description ?? '');
  const quantity = qty ?? item.min_quantity;
  const isFav = !!favs.data?.includes(item.product_id);
  const gallery = images.length ? images : item.image_url ? [{ url: item.image_url, alt: name }] : [];
  const specs = Object.entries(details?.specs ?? {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object');
  const nutrition = Object.entries(details?.nutrition ?? {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object');
  const recommendCount = details?.recommend_count ?? 0;
  const others = otherStores.filter((o) => o.inventory_id !== item.inventory_id);
  const average = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  const share = () => Share.share({
    message: t('product.shareText', { name, price: money(item.effective_price_usd), store: item.store_name }),
  }).catch(() => undefined);

  const header = (
    <View style={{ gap: spacing.lg }}>
      {gallery.length ? (
        <View>
          <FlatList
            horizontal
            pagingEnabled
            data={gallery}
            keyExtractor={(g, i) => g.url + i}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / W))}
            renderItem={({ item: g }) => (
              <Image source={{ uri: g.url }} style={{ width: W, height: W * 0.8, backgroundColor: colors.surface }} contentFit="contain" accessibilityLabel={g.alt ?? name} />
            )}
          />
          {gallery.length > 1 ? (
            <Row gap={6} style={styles.dots}>
              {gallery.map((g, i) => <View key={g.url + i} style={[styles.dot, { width: i === slide ? 18 : 6, backgroundColor: i === slide ? colors.primary : colors.border }]} />)}
            </Row>
          ) : null}
          {item.on_promo ? (
            <View style={[styles.promo, { backgroundColor: colors.primary }]}><T size="xs" weight="800" color={colors.onPrimary}>{t('product.promo')}</T></View>
          ) : null}
        </View>
      ) : (
        <View style={{ height: 220, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt }}>
          <Ionicons name="image-outline" size={64} color={colors.textMuted} />
        </View>
      )}

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <View style={{ gap: 6 }}>
          {item.brand ? <T size="sm" weight="600" color={colors.accent2}>{item.brand}</T> : null}
          <T size="xl" weight="800">{name}</T>
          <PriceTag item={item} large />
          <T size="sm" muted>/{item.unit_size ? ` ${item.unit_size}` : ''} {t(`unit.${item.unit}`)}</T>
          <Row gap={14} style={{ flexWrap: 'wrap', marginTop: 4 }}>
            {item.rating_count > 0 ? (
              <Row gap={4}><Ionicons name="star" size={15} color={colors.warning} /><T size="sm" weight="600">{Number(item.rating).toFixed(1)}</T><T size="sm" muted>({item.rating_count})</T></Row>
            ) : null}
            <Row gap={4}><Ionicons name="thumbs-up" size={14} color={colors.accent} /><T size="sm" muted>{t('product.recommendCount', { n: recommendCount })}</T></Row>
            {item.sold_count > 0 ? <Row gap={4}><Ionicons name="bag-check-outline" size={15} color={colors.success} /><T size="sm" muted>{t('product.soldCount', { n: item.sold_count })}</T></Row> : null}
          </Row>
        </View>

        <Row gap={8}>
          <Pressable
            onPress={() => (session ? reco.toggle.mutate(!reco.recommended) : router.push('/(auth)/sign-in'))}
            disabled={reco.toggle.isPending}
            accessibilityRole="button"
            style={[styles.action, { borderColor: reco.recommended ? colors.accent : colors.border, backgroundColor: reco.recommended ? colors.accent : colors.surface }]}
          >
            <Ionicons name={reco.recommended ? 'thumbs-up' : 'thumbs-up-outline'} size={18} color={reco.recommended ? '#FFFFFF' : colors.accent} />
            <T size="sm" weight="700" color={reco.recommended ? '#FFFFFF' : colors.text}>{reco.recommended ? t('product.recommended') : t('product.recommend')}</T>
          </Pressable>
          <Pressable onPress={share} accessibilityRole="button" style={[styles.action, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Ionicons name="share-social-outline" size={18} color={colors.text} />
            <T size="sm" weight="700">{t('product.share')}</T>
          </Pressable>
          {session ? (
            <Pressable onPress={() => toggleFav.mutate({ productId: item.product_id, isFavorite: isFav })} accessibilityRole="button" accessibilityLabel={t('favorites.title')}
              style={[styles.iconAction, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={20} color={colors.primary} />
            </Pressable>
          ) : null}
        </Row>

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={8} style={{ flex: 1 }}>
              <Ionicons name="storefront-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <T size="xs" muted>{t('product.availableAt')}</T>
                <T weight="700" numberOfLines={1}>{item.store_name}</T>
              </View>
            </Row>
            <T weight="700" color={item.in_stock ? colors.success : colors.danger}>{item.in_stock ? t('product.inStock') : t('product.outOfStock')}</T>
          </Row>
          {item.min_quantity > 1 ? <T size="sm" muted>{t('product.minQty', { qty: formatQty(item.min_quantity, item.unit, t) })}</T> : null}
          {item.in_stock ? (
            <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
              <QuantityStepper value={quantity} step={item.quantity_step} min={item.min_quantity} max={item.stock} onChange={(v) => setQty(Math.max(v, item.min_quantity))} />
              <T size="lg" weight="800">{money(item.effective_price_usd * quantity)}</T>
            </Row>
          ) : null}
        </Card>

        {others.length > 0 ? (
          <View style={{ gap: 8 }}>
            <SectionHeader title={t('product.otherStores')} />
            {others.map((o) => (
              <Card key={o.inventory_id} onPress={() => router.replace(`/product/${o.inventory_id}`)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T style={{ flex: 1 }}>{o.store_name}</T>
                  <T weight="700">{money(o.effective_price_usd)}</T>
                  <View style={[styles.stock, { backgroundColor: o.in_stock ? colors.success : colors.danger }]} />
                </Row>
              </Card>
            ))}
          </View>
        ) : null}

        <Card>
          <SectionHeader title={t('product.details')} />
          {description ? <T style={{ lineHeight: 22 }}>{description}</T> : <T muted size="sm">{t('product.noDescription')}</T>}
          <View>
            {item.brand ? <SpecRow label={t('product.brand')} value={item.brand} /> : null}
            <SpecRow label={t('product.unit')} value={`${item.unit_size ? `${item.unit_size} ` : ''}${t(`unit.${item.unit}`)}`} />
            {item.barcode ? <SpecRow label={t('product.barcode')} value={item.barcode} /> : null}
            {details?.storage_conditions ? <SpecRow label={t('product.storage')} value={details.storage_conditions} /> : null}
            {details?.allergens?.length ? <SpecRow label={t('product.allergens')} value={details.allergens.join(', ')} /> : null}
            {specs.map(([k, v]) => <SpecRow key={k} label={k} value={String(v)} />)}
          </View>
          {nutrition.length ? (
            <View style={{ gap: 4 }}>
              <T weight="700" size="sm">{t('product.nutrition')}</T>
              {nutrition.map(([k, v]) => <SpecRow key={k} label={k} value={String(v)} />)}
            </View>
          ) : null}
        </Card>

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <SectionHeader title={t('product.comments')} />
            {reviews.length ? (
              <Row gap={4}><Ionicons name="star" size={15} color={colors.warning} /><T weight="700">{average.toFixed(1)}</T><T size="sm" muted>/5 · {reviews.length}</T></Row>
            ) : null}
          </Row>
          {reviewable.data ? (
            <Button title={t('product.writeReview')} icon="create-outline" variant="secondary" onPress={() => router.push(`/order/review/${reviewable.data}`)} />
          ) : (
            <T size="xs" muted>{t('product.verifiedOnly')}</T>
          )}
          {reviews.length === 0 ? <T muted>{t('product.noReviews')}</T> : reviews.map((r, i) => (
            <View key={r.id} style={{ gap: 4 }}>
              {i > 0 ? <Divider /> : null}
              <Row style={{ justifyContent: 'space-between' }}>
                <Stars value={r.rating} onChange={() => undefined} size={14} />
                <T size="xs" muted>{formatDate(r.created_at, language, false)}</T>
              </Row>
              <Row gap={4}><Ionicons name="shield-checkmark" size={13} color={colors.success} /><T size="xs" weight="600" color={colors.success}>{t('product.verifiedBuyer')}</T></Row>
              {r.comment ? <T size="sm" style={{ lineHeight: 20 }}>{r.comment}</T> : null}
            </View>
          ))}
        </Card>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: '' }} />
      <ProductFeedList
        feed={{ kind: 'similar', productId: item.product_id, categoryId: item.category_id, storeId: item.store_id }}
        header={header}
        title={t('product.similar')}
        contentStyle={{ paddingBottom: 96 }}
      />
      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <T size="xs" muted>{t('checkout.total')}</T>
          <T size="lg" weight="800">{money(item.effective_price_usd * quantity)}</T>
        </View>
        <Button
          title={item.in_stock ? t('product.addToCart') : t('product.outOfStock')}
          icon="cart-outline"
          disabled={!item.in_stock}
          loading={pending}
          onPress={() => run(item, quantity)}
          style={{ flex: 1.4 }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  dots: { position: 'absolute', bottom: 10, alignSelf: 'center' },
  dot: { height: 6, borderRadius: 3 },
  promo: { position: 'absolute', top: 12, left: 12, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40 },
  iconAction: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stock: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  specRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, borderTopWidth: 1 },
});
