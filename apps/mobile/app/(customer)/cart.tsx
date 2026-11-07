import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { QuantityStepper } from '@/components/product';
import { ProductFeedList } from '@/components/ProductFeedList';
import { Button, Card, Divider, EmptyState, ErrorState, Loading, Notice, Row, T } from '@/components/ui';
import { useCart, useSetCartQuantity, useTaxRate } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatQty, formatRate } from '@/lib/format';
import { localized } from '@/lib/i18n';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function Cart() {
  const { t, money, language, colors } = useSettings();
  const { session } = useAuth();
  const cart = useCart();
  const setQty = useSetCartQuantity();
  const taxRate = useTaxRate().data ?? 0;

  const lines = cart.data?.lines ?? [];
  const subtotal = lines.reduce((s, l) => s + (l.item ? l.item.effective_price_usd * l.quantity : 0), 0);
  const problems = lines.filter((l) => !l.item || !l.item.in_stock || l.quantity > l.item.stock);
  const change = (inventoryId: string, quantity: number) =>
    setQty.mutate({ inventoryId, quantity }, { onError: (e) => Alert.alert(t('cart.title'), errorMessage(e, t)) });

  let content;
  if (!session) {
    content = <EmptyState icon="person-circle-outline" message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;
  } else if (cart.isLoading) {
    content = <Loading />;
  } else if (cart.error) {
    content = <ErrorState message={errorMessage(cart.error, t)} onRetry={cart.refetch} />;
  } else if (lines.length === 0) {
    content = <EmptyState icon="cart-outline" message={t('cart.empty')} action={t('tab.home')} onAction={() => router.push('/(customer)')} />;
  } else {
    content = (
      <View style={{ gap: spacing.lg }}>
        <Row>
          <Ionicons name="storefront-outline" size={18} color={colors.textMuted} />
          <T muted>{t('cart.store')} <T weight="700">{lines[0]?.item?.store_name ?? ''}</T></T>
        </Row>

        {problems.length > 0 ? <Notice tone="warning" text={t('err.OUT_OF_STOCK')} /> : null}

        {lines.map((l) => (
          <Card key={l.id}>
            <Row gap={12} style={{ alignItems: 'flex-start' }}>
              <View style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}>
                {l.item?.image_url ? <Image source={{ uri: l.item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="image-outline" size={24} color={colors.textMuted} />}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <T weight="600" numberOfLines={2}>{l.item ? localized(l.item.name_i18n, language, l.item.name) : '—'}</T>
                {l.item ? <T size="sm" muted>{money(l.item.effective_price_usd)} / {t(`unit.${l.item.unit}`)}</T> : null}
                {l.item && !l.item.in_stock ? <T size="sm" color={colors.danger}>{t('product.outOfStock')}</T> : null}
                <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
                  {l.item ? (
                    <QuantityStepper
                      value={l.quantity}
                      step={l.item.quantity_step}
                      min={l.item.min_quantity}
                      max={l.item.stock}
                      disabled={setQty.isPending}
                      onChange={(q) => change(l.inventory_id, q)}
                    />
                  ) : (
                    <Button title={t('cart.remove')} variant="ghost" onPress={() => change(l.inventory_id, 0)} />
                  )}
                  <T weight="700">{l.item ? money(l.item.effective_price_usd * l.quantity) : ''}</T>
                </Row>
                {l.item ? <T size="xs" muted>{formatQty(l.quantity, l.item.unit, t)}</T> : null}
              </View>
            </Row>
          </Card>
        ))}

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <T>{t('cart.subtotal')}</T>
            <T size="lg" weight="700">{money(subtotal)}</T>
          </Row>
          {taxRate > 0 ? <T size="xs" muted>{t('cart.taxNote', { rate: formatRate(taxRate) })}</T> : null}
          <Divider />
          <T size="xs" muted>{t('checkout.noCash')}</T>
        </Card>
        <Button title={t('cart.checkout')} icon="lock-closed-outline" disabled={problems.length > 0} onPress={() => router.push('/checkout')} />
      </View>
    );
  }

  return (
    <ProductFeedList
      feed={{ kind: 'featured' }}
      header={<View style={{ padding: spacing.lg, paddingBottom: 0 }}>{content}</View>}
      title={t('cart.featured')}
      refreshing={cart.isRefetching}
      onRefresh={() => cart.refetch()}
      endFooter={false}
    />
  );
}

const styles = StyleSheet.create({
  thumb: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
