import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Dimensions, FlatList, Pressable, View } from 'react-native';
import { PriceTag, QuantityStepper, useAddToCartFlow } from '@/components/product';
import { Button, Card, Divider, ErrorState, Loading, Row, Screen, SectionHeader, T } from '@/components/ui';
import { useCatalogItem, useFavorites, useToggleFavorite } from '@/hooks/data';
import { formatDate, formatQty } from '@/lib/format';
import { localized } from '@/lib/i18n';
import { radius } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const W = Dimensions.get('window').width;

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language, colors, money } = useSettings();
  const { session } = useAuth();
  const q = useCatalogItem(id);
  const favs = useFavorites();
  const toggleFav = useToggleFavorite();
  const { run, pending } = useAddToCartFlow();
  const [qty, setQty] = useState<number | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={t('common.error')} onRetry={q.refetch} />;
  const { item, details, images, otherStores, reviews } = q.data;
  const name = localized(item.name_i18n, language, item.name);
  const quantity = qty ?? item.min_quantity;
  const isFav = !!favs.data?.includes(item.product_id);
  const gallery = images.length ? images : item.image_url ? [{ url: item.image_url, alt: name }] : [];

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () =>
            session ? (
              <Pressable
                onPress={() => toggleFav.mutate({ productId: item.product_id, isFavorite: isFav })}
                accessibilityLabel={t('favorites.title')}
                hitSlop={10}
              >
                <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={24} color={colors.primary} />
              </Pressable>
            ) : null,
        }}
      />
      {gallery.length ? (
        <FlatList
          horizontal
          pagingEnabled
          data={gallery}
          keyExtractor={(g, i) => g.url + i}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item: g }) => <Image source={{ uri: g.url }} style={{ width: W, height: W * 0.8 }} contentFit="contain" accessibilityLabel={g.alt ?? name} />}
        />
      ) : (
        <View style={{ height: 220, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt }}>
          <Ionicons name="image-outline" size={64} color={colors.textMuted} />
        </View>
      )}

      <View style={{ padding: 16, gap: 16 }}>
        <View style={{ gap: 6 }}>
          {item.brand ? <T size="sm" muted>{t('product.brand')} : {item.brand}</T> : null}
          <T size="xl" weight="700">{name}</T>
          <PriceTag item={item} large />
          <T size="sm" muted>/{item.unit_size ? ` ${item.unit_size}` : ''} {t(`unit.${item.unit}`)}</T>
          {item.rating_count > 0 ? (
            <Row gap={4}><Ionicons name="star" size={14} color={colors.warning} /><T size="sm">{Number(item.rating).toFixed(1)} ({item.rating_count})</T></Row>
          ) : null}
        </View>

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T size="xs" muted>{t('product.availableAt')}</T>
              <T weight="600">{item.store_name}</T>
            </View>
            <T weight="600" color={item.in_stock ? colors.success : colors.danger}>
              {item.in_stock ? t('product.inStock') : t('product.outOfStock')}
            </T>
          </Row>
          {item.min_quantity > 1 ? <T size="sm" muted>{t('product.minQty', { qty: formatQty(item.min_quantity, item.unit, t) })}</T> : null}
          {item.in_stock ? (
            <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <QuantityStepper
                value={quantity}
                step={item.quantity_step}
                min={item.min_quantity}
                max={item.stock}
                onChange={(v) => setQty(Math.max(v, item.min_quantity))}
              />
              <T weight="700">{money(item.effective_price_usd * quantity)}</T>
            </Row>
          ) : null}
          <Button title={t('product.addToCart')} icon="cart-outline" disabled={!item.in_stock} loading={pending} onPress={() => run(item, quantity)} />
        </Card>

        {otherStores.filter((o) => o.inventory_id !== item.inventory_id).length > 0 ? (
          <View style={{ gap: 8 }}>
            <SectionHeader title={t('product.availableAt')} />
            {otherStores.filter((o) => o.inventory_id !== item.inventory_id).map((o) => (
              <Card key={o.inventory_id} onPress={() => router.replace(`/product/${o.inventory_id}`)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T style={{ flex: 1 }}>{o.store_name}</T>
                  <T weight="700">{money(o.effective_price_usd)}</T>
                  <T size="xs" color={o.in_stock ? colors.success : colors.danger}>{o.in_stock ? '●' : '○'}</T>
                </Row>
              </Card>
            ))}
          </View>
        ) : null}

        {details?.description ? <T>{details.description}</T> : null}
        {details?.storage_conditions ? <T size="sm"><T size="sm" weight="700">{t('product.storage')} : </T>{details.storage_conditions}</T> : null}
        {details?.allergens?.length ? <T size="sm"><T size="sm" weight="700">{t('product.allergens')} : </T>{details.allergens.join(', ')}</T> : null}

        <Divider />
        <SectionHeader title={t('product.reviews')} />
        {reviews.length === 0 ? <T muted>{t('product.noReviews')}</T> : reviews.map((r) => (
          <View key={r.id} style={{ gap: 2, paddingVertical: 6, borderRadius: radius.sm }}>
            <Row gap={2}>{[1, 2, 3, 4, 5].map((n) => <Ionicons key={n} name={n <= r.rating ? 'star' : 'star-outline'} size={14} color={colors.warning} />)}</Row>
            {r.comment ? <T size="sm">{r.comment}</T> : null}
            <T size="xs" muted>{formatDate(r.created_at, language, false)}</T>
          </View>
        ))}
      </View>
    </Screen>
  );
}
