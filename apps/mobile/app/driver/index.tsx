import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Switch } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { homeForRole } from '@/lib/roles';
import { supabase, unwrap } from '@/lib/supabase';
import { useDriver } from '@/hooks/driver';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

interface Offer {
  assignment_id: string; order_id: string; order_number: string; store_name: string; store_commune: string | null;
  customer_commune: string | null; distance_km: number | null; delivery_fee_usd: number; items_count: number; weight_kg: number; expires_at: string;
}

export default function DriverHome() {
  const { t, money, colors } = useSettings();
  const { loading, profile, session, signOut } = useAuth();
  const qc = useQueryClient();
  const driver = useDriver();
  const [now, setNow] = useState(Date.now());
  const [locError, setLocError] = useState(false);

  const offers = useQuery({
    queryKey: ['driver-offers'],
    enabled: !!driver.data?.is_available,
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await supabase.rpc('get_driver_offers')) as Offer[],
  });
  const active = useQuery({
    queryKey: ['driver-active'],
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.from('delivery_assignments')
      .select('id, order_id, orders(order_number, status, delivery_address, stores(name))')
      .eq('driver_id', session!.user.id).eq('status', 'accepted').order('responded_at')) as unknown as
      { id: string; order_id: string; orders: { order_number: string; status: string; delivery_address: Record<string, string>; stores: { name: string } | null } | null }[],
  });

  // Offres et missions en temps réel.
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel('driver-assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments', filter: `driver_id=eq.${session.user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ['driver-offers'] });
        qc.invalidateQueries({ queryKey: ['driver-active'] });
      })
      .subscribe();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(ch); clearInterval(tick); };
  }, [session, qc]);

  // Partage de position (premier plan) tant que le livreur est disponible ou en mission.
  const sharing = !!driver.data?.is_available || (active.data?.length ?? 0) > 0;
  useEffect(() => {
    if (!sharing) return;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocError(true); return; }
      setLocError(false);
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 20_000, distanceInterval: 30 },
        (pos) => { supabase.rpc('update_driver_location', { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_share: true }).then(() => undefined); },
      );
    })();
    return () => { sub?.remove(); };
  }, [sharing]);

  if (loading || driver.isLoading) return <Loading />;
  if (profile?.role !== 'driver') return <Redirect href={homeForRole(profile?.role)} />;
  const d = driver.data;

  const toggle = async (v: boolean) => {
    try {
      unwrap(await supabase.rpc('set_driver_availability', { p_available: v }));
      qc.invalidateQueries({ queryKey: ['driver-me'] });
    } catch (e) {
      Alert.alert(t('role.driver'), errorMessage(e, t));
    }
  };

  const respond = async (o: Offer, accept: boolean) => {
    try {
      const r = unwrap(await supabase.rpc('respond_to_offer', { p_assignment_id: o.assignment_id, p_accept: accept, p_reason: null })) as { ok: boolean; reason?: string };
      if (!r.ok) Alert.alert(t('driver.offers'), t('err.OFFER_NOT_PENDING'));
      qc.invalidateQueries({ queryKey: ['driver-offers'] });
      qc.invalidateQueries({ queryKey: ['driver-active'] });
      if (accept && r.ok) router.push(`/driver/mission/${o.order_id}`);
    } catch (e) {
      Alert.alert(t('driver.offers'), errorMessage(e, t));
    }
  };

  return (
    <Screen>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T size="lg" weight="700">{profile.full_name ?? profile.email}</T>
          <T size="sm" color={d?.status === 'verified' ? colors.success : colors.warning}>{d ? t(`driver.status.${d.status as 'verified'}`) : ''}</T>
        </Row>
        {d?.status === 'verified' ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <T>{d.is_available ? t('driver.available') : t('driver.unavailable')}</T>
            <Switch value={d.is_available} onValueChange={toggle} trackColor={{ true: colors.success }} />
          </Row>
        ) : <Notice text={t('err.DRIVER_NOT_VERIFIED')} />}
        {sharing ? <T size="xs" muted>{t('driver.shareLocation')}</T> : null}
        {locError ? <Notice tone="warning" text={t('driver.locationDenied')} /> : null}
      </Card>

      <SectionHeader title={t('driver.offers')} />
      {!d?.is_available ? null : !offers.data?.length ? <T muted>{t('driver.noOffers')}</T> : offers.data.map((o) => {
        const left = Math.max(0, Math.round((new Date(o.expires_at).getTime() - now) / 1000));
        return (
          <Card key={o.assignment_id} style={{ borderColor: colors.primary, borderWidth: 2 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T weight="700">{o.order_number}</T>
              <T size="sm" color={left < 30 ? colors.danger : colors.textMuted}>{t('driver.expiresIn', { s: left })}</T>
            </Row>
            <Row><Ionicons name="storefront-outline" size={16} color={colors.textMuted} /><T size="sm">{o.store_name}{o.store_commune ? ` (${o.store_commune})` : ''}</T></Row>
            <Row><Ionicons name="flag-outline" size={16} color={colors.textMuted} /><T size="sm">{o.customer_commune}</T></Row>
            <T size="sm" muted>{t('driver.items', { n: o.items_count, kg: Number(o.weight_kg).toFixed(1) })}{o.distance_km != null ? ` · ${t('stores.km', { km: o.distance_km })}` : ''}</T>
            <T weight="600">{t('driver.fee', { amount: money(o.delivery_fee_usd) })}</T>
            <Row>
              <Button style={{ flex: 1 }} title={t('driver.accept')} onPress={() => respond(o, true)} disabled={left === 0} />
              <Button title={t('driver.refuse')} variant="ghost" onPress={() => respond(o, false)} />
            </Row>
          </Card>
        );
      })}

      <SectionHeader title={t('driver.active')} />
      {!active.data?.length ? <T muted>{t('driver.noActive')}</T> : active.data.map((a) => (
        <Card key={a.id} onPress={() => router.push(`/driver/mission/${a.order_id}`)}>
          <T weight="700">{a.orders?.order_number}</T>
          <T size="sm">{a.orders?.stores?.name} → {a.orders?.delivery_address?.commune}</T>
          <T size="sm" color={colors.primary}>{a.orders ? t(`status.${a.orders.status as 'ready'}`) : ''}</T>
        </Card>
      ))}

      <Row>
        <Button style={{ flex: 1 }} title={t('driver.earnings')} variant="secondary" icon="wallet-outline" onPress={() => router.push('/driver/earnings')} />
        <Button style={{ flex: 1 }} title={t('driver.card')} variant="secondary" icon="id-card-outline" onPress={() => router.push('/driver/card')} />
      </Row>
      <Button title={t('notifications.title')} variant="ghost" icon="notifications-outline" onPress={() => router.push('/notifications')} />
      <Button title={t('auth.signOut')} variant="ghost" icon="log-out-outline" onPress={() => signOut().then(() => router.replace('/'))} />
    </Screen>
  );
}
