import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { useDriver, useDriverOffers, type Offer } from '@/hooks/driver';
import { errorMessage } from '@/lib/errors';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

export default function DriverOffers() {
  const { t, money, colors } = useSettings();
  const qc = useQueryClient();
  const driver = useDriver();
  const online = !!driver.data?.is_available;
  const offers = useDriverOffers(online);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const respond = async (o: Offer, accept: boolean) => {
    try {
      const r = unwrap(await supabase.rpc('respond_to_offer', { p_assignment_id: o.assignment_id, p_accept: accept, p_reason: null })) as { ok: boolean };
      if (!r.ok) Alert.alert(t('driver.offers'), t('err.OFFER_NOT_PENDING'));
      qc.invalidateQueries({ queryKey: ['driver-offers'] });
      qc.invalidateQueries({ queryKey: ['driver-active'] });
      if (accept && r.ok) router.replace(`/driver/mission/${o.order_id}`);
    } catch (e) {
      Alert.alert(t('driver.offers'), errorMessage(e, t));
    }
  };

  if (driver.isLoading) return <Loading />;
  if (!online) return <Screen><Notice tone="warning" text={t('driver.goOnlineFirst')} /></Screen>;
  if (offers.isLoading) return <Loading />;
  if (!offers.data?.length) return <EmptyState icon="search-outline" message={t('driver.noOffers')} action={t('common.retry')} onAction={() => offers.refetch()} />;

  return (
    <Screen>
      {offers.data.map((o) => {
        const left = Math.max(0, Math.round((new Date(o.expires_at).getTime() - now) / 1000));
        const urgent = left < 30;
        return (
          <View key={o.assignment_id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T size="lg" weight="800">{o.order_number}</T>
              <View style={[styles.timer, { backgroundColor: urgent ? colors.danger : colors.primarySoft }]}>
                <Ionicons name="timer-outline" size={14} color={urgent ? '#FFFFFF' : colors.primary} />
                <T size="sm" weight="800" color={urgent ? '#FFFFFF' : colors.primary}>{t('driver.expiresIn', { s: left })}</T>
              </View>
            </Row>
            <View style={styles.leg}>
              <View style={[styles.legDot, { backgroundColor: colors.accent2 }]} />
              <View style={{ flex: 1 }}>
                <T size="xs" muted>{t('driver.pickup')}</T>
                <T weight="700">{o.store_name}{o.store_commune ? ` · ${o.store_commune}` : ''}</T>
              </View>
            </View>
            <View style={[styles.legLine, { backgroundColor: colors.border }]} />
            <View style={styles.leg}>
              <View style={[styles.legDot, { backgroundColor: colors.primary }]} />
              <View style={{ flex: 1 }}>
                <T size="xs" muted>{t('driver.dropoff')}</T>
                <T weight="700">{o.customer_commune ?? '—'}</T>
              </View>
            </View>
            <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <T size="sm" muted>{t('driver.items', { n: o.items_count, kg: Number(o.weight_kg).toFixed(1) })}{o.distance_km != null ? ` · ${t('stores.km', { km: o.distance_km })}` : ''}</T>
              <T size="lg" weight="800" color={colors.success}>{money(o.delivery_fee_usd)}</T>
            </Row>
            <Row>
              <Button style={{ flex: 1 }} title={t('driver.accept')} icon="checkmark" onPress={() => respond(o, true)} disabled={left === 0} />
              <Button title={t('driver.refuse')} variant="ghost" onPress={() => respond(o, false)} />
            </Row>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legDot: { width: 12, height: 12, borderRadius: 6 },
  legLine: { width: 2, height: 14, marginLeft: 5 },
});
