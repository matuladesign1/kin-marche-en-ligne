import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { Button, Loading, Notice, Row, Screen, T, type IconName } from '@/components/ui';
import { useDriver, useDriverActive, useDriverOffers, useDriverToday } from '@/hooks/driver';
import { errorMessage } from '@/lib/errors';
import type { TranslationKey } from '@/lib/i18n';
import { homeForRole } from '@/lib/roles';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

function ActionRow({ icon, tint, title, subtitle, onPress, badge }: { icon: IconName; tint: string; title: string; subtitle: string; onPress: () => void; badge?: number }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.action, { backgroundColor: colors.surface, borderColor: `${tint}55`, opacity: pressed ? 0.9 : 1 }]}>
      <View style={[styles.actionIcon, { backgroundColor: `${tint}1F` }]}><Ionicons name={icon} size={24} color={tint} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="800" size="lg">{title}</T>
        <T size="sm" muted>{subtitle}</T>
      </View>
      {badge ? <View style={[styles.smallBadge, { backgroundColor: colors.primary }]}><T size="xs" weight="800" color={colors.onPrimary}>{badge}</T></View> : null}
      <View style={[styles.chevron, { backgroundColor: `${tint}1F` }]}><Ionicons name="chevron-forward" size={16} color={tint} /></View>
    </Pressable>
  );
}

export default function DriverHome() {
  const { t, money, colors } = useSettings();
  const { loading, profile, session, signOut } = useAuth();
  const qc = useQueryClient();
  const driver = useDriver();
  const offers = useDriverOffers(!!driver.data?.is_available);
  const active = useDriverActive();
  const today = useDriverToday();
  const [locError, setLocError] = useState(false);
  const purple = '#7B4BC4';

  // Offres et missions en temps réel.
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel('driver-assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments', filter: `driver_id=eq.${session.user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ['driver-offers'] });
        qc.invalidateQueries({ queryKey: ['driver-active'] });
        qc.invalidateQueries({ queryKey: ['driver-today'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, qc]);

  const activeOrderIds = useRef<string[]>([]);
  activeOrderIds.current = (active.data ?? []).map((a) => a.order_id);

  // Partage de position (premier plan) tant que le livreur est en ligne ou en mission.
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
        async (pos) => {
          await supabase.rpc('update_driver_location', { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_share: true });
          // Itinéraire réel (Google Routes) recalculé côté serveur, au plus une fois par minute.
          for (const orderId of activeOrderIds.current) {
            supabase.functions.invoke('delivery-eta', { body: { order_id: orderId } }).then(() => undefined);
          }
        },
      );
    })();
    return () => { sub?.remove(); };
  }, [sharing]);

  if (loading || driver.isLoading) return <Loading />;
  if (profile?.role !== 'driver') return <Redirect href={homeForRole(profile?.role)} />;
  const d = driver.data;
  const verified = d?.status === 'verified';
  const online = !!d?.is_available;
  const offerCount = offers.data?.length ?? 0;

  const toggle = async (v: boolean) => {
    try {
      unwrap(await supabase.rpc('set_driver_availability', { p_available: v }));
      qc.invalidateQueries({ queryKey: ['driver-me'] });
    } catch (e) {
      Alert.alert(t('driver.spaceTitle'), errorMessage(e, t));
    }
  };

  return (
    <Screen>
      {/* Statut en ligne */}
      <View style={[styles.status, { backgroundColor: colors.surface, borderColor: online ? colors.success : colors.border }]}>
        <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.textMuted }]} />
        <View style={{ flex: 1 }}>
          <T size="xl" weight="800" color={online ? colors.success : colors.text}>{online ? t('driver.online') : t('driver.offline')}</T>
          <T size="sm" muted>{verified ? (online ? t('driver.onlineHint') : t('driver.offlineHint')) : t(`driver.status.${(d?.status ?? 'pending_review') as 'verified'}` as TranslationKey)}</T>
        </View>
        {verified ? (
          <Switch value={online} onValueChange={toggle} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#FFFFFF" />
        ) : null}
      </View>
      {!d ? <Button title={t('driver.completeFile')} icon="document-text-outline" onPress={() => router.push('/driver-signup')} /> : null}
      {d && !verified ? <Notice text={t('err.DRIVER_NOT_VERIFIED')} /> : null}
      {locError ? <Notice tone="warning" text={t('driver.locationDenied')} /> : null}

      {/* Solde */}
      <View style={[styles.balance, { backgroundColor: colors.surface, borderColor: `${colors.accent2}55` }]}>
        <Row gap={14}>
          <View style={[styles.wallet, { backgroundColor: `${colors.accent2}1A` }]}>
            <Ionicons name="wallet-outline" size={28} color={colors.accent2} />
          </View>
          <View style={{ flex: 1 }}>
            <T size="sm" muted>{t('driver.balanceLabel')}</T>
            <T size="xxl" weight="800">{money(today.data?.balance ?? 0)}</T>
          </View>
        </Row>
        <T size="sm" muted style={{ lineHeight: 19 }}>{t('driver.balanceNote')}</T>
      </View>

      {/* Courses disponibles */}
      <Pressable onPress={() => router.push('/driver/offers')} accessibilityRole="button"
        style={({ pressed }) => [styles.cta, { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 }]}>
        <Ionicons name="search" size={20} color={colors.onPrimary} />
        <T size="lg" weight="800" color={colors.onPrimary}>{t('driver.seeRuns')}</T>
        {offerCount ? <View style={styles.ctaBadge}><T size="sm" weight="800" color={colors.primary}>{offerCount}</T></View> : null}
      </Pressable>

      {/* Course en cours */}
      {(active.data ?? []).map((a) => (
        <Pressable key={a.id} onPress={() => router.push(`/driver/mission/${a.order_id}`)}
          style={[styles.mission, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={6}><MaterialCommunityIcons name="moped" size={20} color={colors.accent} /><T weight="800">{t('driver.currentRun')}</T></Row>
            <T weight="800">{a.orders?.order_number}</T>
          </Row>
          <T size="sm">{a.orders?.stores?.name} → {a.orders?.delivery_address?.commune}</T>
          <Row style={{ justifyContent: 'space-between' }}>
            <T size="sm" weight="700" color={colors.primary}>{a.orders ? t(`status.${a.orders.status}` as TranslationKey) : ''}</T>
            {a.eta_minutes ? <T size="sm" muted>{t('orders.eta', { min: a.eta_minutes })}</T> : null}
          </Row>
        </Pressable>
      ))}

      {/* Aujourd'hui */}
      <Row gap={8}><T size="lg" weight="800">{t('driver.today')}</T><Ionicons name="calendar-outline" size={18} color={colors.textMuted} /></Row>
      <Row gap={spacing.md}>
        <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="checkmark-circle" size={28} color={colors.success} />
          <T size="xl" weight="800">{today.data?.deliveredToday ?? 0}</T>
          <T size="sm" muted>{t('driver.deliveredToday')}</T>
        </View>
        <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="cash-multiple" size={28} color={purple} />
          <T size="xl" weight="800">{money(today.data?.earnedToday ?? 0)}</T>
          <T size="sm" muted>{t('driver.earnedToday')}</T>
        </View>
      </Row>

      {/* Actions */}
      <T size="lg" weight="800">{t('driver.actions')}</T>
      <ActionRow icon="search" tint={colors.accent} title={t('driver.availableRuns')} subtitle={t('driver.availableRunsHint')} badge={offerCount} onPress={() => router.push('/driver/offers')} />
      <ActionRow icon="time-outline" tint={purple} title={t('driver.history')} subtitle={t('driver.historyHint')} onPress={() => router.push('/driver/history')} />
      <ActionRow icon="wallet-outline" tint={colors.accent2} title={t('driver.earnings')} subtitle={t('driver.earningsHint')} onPress={() => router.push('/driver/earnings')} />
      <ActionRow icon="id-card-outline" tint={colors.warning} title={t('driver.card')} subtitle={t('driver.cardHint')} onPress={() => router.push('/driver/card')} />
      <ActionRow icon="chatbubbles-outline" tint={colors.primary} title={t('inbox.title')} subtitle={t('driver.messagesHint')} onPress={() => router.push('/support')} />

      <Row>
        <Button style={{ flex: 1 }} title={t('notifications.title')} variant="ghost" icon="notifications-outline" onPress={() => router.push('/notifications')} />
        <Button style={{ flex: 1 }} title={t('auth.signOut')} variant="ghost" icon="log-out-outline" onPress={() => signOut().then(() => router.replace('/'))} />
      </Row>
      <AppFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 2, borderRadius: radius.lg, padding: spacing.lg },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  balance: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  wallet: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.lg, minHeight: 58,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  ctaBadge: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  mission: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, gap: 6 },
  stat: { flex: 1, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md },
  actionIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  smallBadge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
});
