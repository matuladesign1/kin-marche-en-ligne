import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CERTIFIED_BLUE, CertifiedBadge } from '@/components/CertifiedBadge';
import { MapBlock } from '@/components/Map';
import { StatusTimeline } from '@/components/StatusTimeline';
import { Button, Card, Divider, ErrorState, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { qk, useOrder } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatQty } from '@/lib/format';
import { decodePolyline } from '@/lib/polyline';
import { supabase, unwrap } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

const ACTIVE_DELIVERY = ['driver_assigned', 'driver_to_store', 'picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'];

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, money, language, colors } = useSettings();
  const qc = useQueryClient();
  const q = useOrder(id);

  // Temps réel : statut de la commande et position du livreur.
  useEffect(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: qk.order(id) });
    const ch = supabase
      .channel(`order-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_tracking' }, refresh)
      .subscribe();
    const timer = setInterval(refresh, 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(timer); };
  }, [id, qc]);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data?.order) return <ErrorState message={t('common.error')} onRetry={q.refetch} />;
  const { order, items, otp, tracking } = q.data;
  const unpaid = order.status === 'received' && ['pending', 'failed'].includes(order.payment_status);
  const delivering = ACTIVE_DELIVERY.includes(order.status);
  const addr = order.delivery_address as Record<string, string | number | null>;

  const cancel = () =>
    Alert.alert(t('orders.cancel'), t('orders.cancelConfirm'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('common.yes'), style: 'destructive', onPress: async () => {
        try {
          unwrap(await supabase.rpc('cancel_order', { p_order_id: id, p_reason: null }));
          qc.invalidateQueries({ queryKey: qk.order(id) });
          qc.invalidateQueries({ queryKey: qk.orders });
        } catch (e) {
          Alert.alert(t('orders.cancel'), errorMessage(e, t));
        }
      } },
    ]);

  return (
    <Screen>
      <Card>
        <T size="lg" weight="700">{t('orders.number', { n: order.order_number })}</T>
        <T size="sm" muted>{order.stores?.name} · {formatDate(order.created_at, language)}</T>
        <T weight="600" color={colors.primary}>{t(`status.${order.status}`)} · {t(`payStatus.${order.payment_status}`)}</T>
      </Card>

      {unpaid ? (
        <Row>
          <Button style={{ flex: 1 }} title={t('orders.pay')} icon="card-outline" onPress={() => router.push(`/payment/${order.id}`)} />
          <Button title={t('orders.cancel')} variant="ghost" onPress={cancel} />
        </Row>
      ) : null}
      {unpaid ? <Button title={t('orders.submitProof')} variant="secondary" icon="document-attach-outline" onPress={() => router.push(`/order/proof/${order.id}`)} /> : null}
      {order.status === 'completed' ? <Button title={t('orders.review')} variant="secondary" icon="star-outline" onPress={() => router.push(`/order/review/${order.id}`)} /> : null}

      {otp && !otp.verified_at && order.payment_status === 'succeeded' ? (
        <Card style={{ borderColor: colors.primary, borderWidth: 2, alignItems: 'center' }}>
          <T size="sm" muted>{t('orders.otp')}</T>
          <T size="xxl" weight="700" style={{ letterSpacing: 8 }}>{otp.code}</T>
          <T size="xs" muted style={{ textAlign: 'center' }}>{t('orders.otpHelp')}</T>
        </Card>
      ) : null}

      {tracking?.driver && delivering ? (
        <Card>
          <SectionHeader title={t('orders.driver')} />
          <Row gap={12}>
            {tracking.driver.avatar_url ? (
              <Image source={{ uri: tracking.driver.avatar_url }} style={{ width: 56, height: 56, borderRadius: 28 }} />
            ) : <Ionicons name="person-circle-outline" size={56} color={colors.textMuted} />}
            <View style={{ flex: 1 }}>
              <Row gap={6}>
                <T weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>{tracking.driver.name}</T>
                {tracking.driver.verified ? <CertifiedBadge size={18} label={t('driver.status.verified')} /> : null}
              </Row>
              {tracking.driver.verified ? <T size="xs" weight="700" color={CERTIFIED_BLUE}>{t('driver.certifiedBy')}</T> : null}
              <T size="sm" muted>{tracking.driver.driver_code}{tracking.driver.transport ? ` · ${tracking.driver.transport}` : ''}</T>
            </View>
            {tracking.driver.phone ? (
              <Button title={t('common.call')} icon="call-outline" variant="secondary" onPress={() => Linking.openURL(`tel:${tracking.driver!.phone}`)} />
            ) : null}
          </Row>
          {tracking.position?.straight_line_km_to_customer != null ? (
            <T size="sm">{t('orders.position', { km: tracking.position.straight_line_km_to_customer })} · {formatDate(tracking.position.recorded_at, language)}</T>
          ) : null}
          {tracking.assignment?.eta_minutes != null ? (
            <T size="sm" weight="600">
              {t('orders.eta', { min: tracking.assignment.eta_minutes })}
              {tracking.assignment.route_distance_km != null ? ` · ${t('stores.km', { km: tracking.assignment.route_distance_km })}` : ''}
              {tracking.assignment.eta_target === 'store' ? ` (${t('driver.pickup')})` : ''}
            </T>
          ) : null}
          {tracking.assignment?.eta_updated_at ? <T size="xs" muted>{t('orders.etaSource', { time: formatDate(tracking.assignment.eta_updated_at, language) })}</T> : null}
        </Card>
      ) : null}

      {delivering ? (
        <MapBlock
          height={260}
          route={decodePolyline(tracking?.assignment?.route_polyline)}
          points={[
            ...(tracking?.store.latitude != null ? [{ id: 'store', latitude: tracking.store.latitude, longitude: tracking.store.longitude!, title: tracking.store.name, color: colors.accent2 }] : []),
            ...(addr.latitude != null ? [{ id: 'home', latitude: Number(addr.latitude), longitude: Number(addr.longitude), title: t('checkout.address'), color: colors.primary }] : []),
            ...(tracking?.position ? [{ id: 'driver', latitude: tracking.position.latitude, longitude: tracking.position.longitude, title: tracking.driver?.name ?? t('orders.driver'), color: colors.success }] : []),
          ]}
        />
      ) : null}

      <Card>
        <StatusTimeline status={order.status} history={tracking?.history ?? []} />
      </Card>

      <Card>
        <SectionHeader title={t('orders.items')} />
        {items.map((i) => (
          <Row key={i.id} style={{ justifyContent: 'space-between' }}>
            <T size="sm" style={{ flex: 1 }}>{i.product_name} × {formatQty(Number(i.quantity), i.unit, t)}</T>
            <T size="sm">{money(i.line_total_usd)}</T>
          </Row>
        ))}
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}><T size="sm">{t('cart.subtotal')}</T><T size="sm">{money(order.subtotal_usd)}</T></Row>
        <Row style={{ justifyContent: 'space-between' }}><T size="sm">{t('checkout.deliveryFee')}</T><T size="sm">{money(order.delivery_fee_usd)}</T></Row>
        {order.coupon_discount_usd > 0 ? <Row style={{ justifyContent: 'space-between' }}><T size="sm">{t('checkout.couponDiscount')}</T><T size="sm">− {money(order.coupon_discount_usd)}</T></Row> : null}
        {order.loyalty_discount_usd > 0 ? <Row style={{ justifyContent: 'space-between' }}><T size="sm">{t('checkout.loyaltyDiscount')}</T><T size="sm">− {money(order.loyalty_discount_usd)}</T></Row> : null}
        <Row style={{ justifyContent: 'space-between' }}><T weight="700">{t('checkout.total')}</T><T weight="700">{money(order.total_usd)}</T></Row>
        {order.paid_at ? <T size="xs" muted>{t('payStatus.succeeded')} · {formatDate(order.paid_at, language)}</T> : null}
      </Card>

      <Card>
        <SectionHeader title={t('checkout.address')} />
        <T size="sm">{[addr.avenue, addr.street_number, addr.quartier, addr.commune, addr.city].filter(Boolean).join(', ')}</T>
        {addr.landmark ? <T size="xs" muted>{String(addr.landmark)}</T> : null}
        {order.delivery_instructions ? <Notice text={order.delivery_instructions} /> : null}
      </Card>

      <Button title={t('orders.support')} variant="ghost" icon="chatbubbles-outline" onPress={() => router.push(`/support?orderId=${order.id}`)} />
    </Screen>
  );
}
