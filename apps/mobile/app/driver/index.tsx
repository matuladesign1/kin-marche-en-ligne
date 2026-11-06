import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { Button, Loading, Notice, T, type IconName } from '@/components/ui';
import { useUnreadCount } from '@/hooks/data';
import { useDriver, useDriverActive, useDriverOffers, useDriverToday } from '@/hooks/driver';
import { errorMessage } from '@/lib/errors';
import { incomingCall } from '@/lib/kincall';
import type { TranslationKey } from '@/lib/i18n';
import { homeForRole } from '@/lib/roles';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Thème de l'espace livreur : bandeau bleu nuit (statut, gains du jour, solde), accents turquoise Kin Marché,
// vert « en ligne », grandes zones tactiles pour une utilisation en déplacement.
const NAVY = '#0E1E33';
const NAVY_2 = '#081323';
const TURQUOISE = '#1CB7B8';
const ONLINE = '#22C55E';
const VIOLET = '#8B5CF6';
const AMBER = '#F59E0B';

function HeroBackground({ online }: { online: boolean }) {
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="drvBg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={NAVY} />
          <Stop offset="1" stopColor={NAVY_2} />
        </LinearGradient>
        <RadialGradient id="drvGlow" cx="88%" cy="8%" r="60%">
          <Stop offset="0" stopColor={online ? ONLINE : TURQUOISE} stopOpacity={online ? 0.35 : 0.22} />
          <Stop offset="1" stopColor={NAVY} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#drvBg)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#drvGlow)" />
      <Circle cx="8%" cy="96%" r="70" fill={TURQUOISE} opacity={0.07} />
    </Svg>
  );
}

function Kpi({ icon, tint, value, label }: { icon: IconName; tint: string; value: string; label: string }) {
  return (
    <View style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: `${tint}2E` }]}><Ionicons name={icon} size={18} color={tint} /></View>
      <T size={value.length > 9 ? 'md' : 'lg'} weight="800" color="#FFFFFF" numberOfLines={1}>{value}</T>
      <T size="xs" color="#AFC0D3" numberOfLines={1}>{label}</T>
    </View>
  );
}

function Tile({ icon, tint, title, subtitle, onPress, badge }: { icon: IconName; tint: string; title: string; subtitle: string; onPress: () => void; badge?: number }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.88 : 1 }]}>
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: `${tint}1F` }]}><Ionicons name={icon} size={22} color={tint} /></View>
        {badge ? <View style={[styles.badge, { backgroundColor: colors.primary }]}><T size="xs" weight="800" color="#FFFFFF">{badge > 99 ? '99+' : badge}</T></View> : null}
      </View>
      <T weight="800" numberOfLines={2}>{title}</T>
      <T size="xs" muted numberOfLines={2}>{subtitle}</T>
    </Pressable>
  );
}

export default function DriverHome() {
  const { t, money, colors } = useSettings();
  const { loading, profile, session, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const driver = useDriver();
  const offers = useDriverOffers(!!driver.data?.is_available);
  const active = useDriverActive();
  const today = useDriverToday();
  const unread = useUnreadCount();
  const [locError, setLocError] = useState(false);
  // Barre d'état claire sur le bandeau bleu nuit, seulement quand cet écran est affiché.
  const [focused, setFocused] = useState(true);
  // Écran d'appel plein écran (Android 14+ : autorisation « notifications plein écran »), revérifiée à chaque retour.
  const [fullScreenOk, setFullScreenOk] = useState(() => incomingCall.canUseFullScreen());
  useFocusEffect(useCallback(() => {
    setFocused(true);
    setFullScreenOk(incomingCall.canUseFullScreen());
    return () => setFocused(false);
  }, []));

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
  const firstName = (profile?.full_name ?? '').trim().split(/\s+/)[0];

  const toggle = async (v: boolean) => {
    try {
      unwrap(await supabase.rpc('set_driver_availability', { p_available: v }));
      qc.invalidateQueries({ queryKey: ['driver-me'] });
    } catch (e) {
      Alert.alert(t('driver.spaceTitle'), errorMessage(e, t));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {focused ? <StatusBar style="light" /> : null}
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}>
        {/* Bandeau : bonjour, statut en ligne, chiffres du jour */}
        <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
          <HeroBackground online={online} />
          <View style={styles.heroTop}>
            <View style={[styles.avatar, { borderColor: online ? ONLINE : 'rgba(255,255,255,0.25)' }]}>
              <MaterialCommunityIcons name="moped" size={26} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T size="xs" weight="700" color="#8FB3C9">{t('driver.spaceTitle').toUpperCase()}</T>
              <View style={styles.nameRow}>
                <T size="xl" weight="800" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {firstName ? t('driver.hello', { name: firstName }) : t('driver.spaceTitle')}
                </T>
                {verified ? <CertifiedBadge size={20} label={t('driver.status.verified')} /> : null}
              </View>
            </View>
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('notifications.title')} style={styles.iconBtn}>
              <Ionicons name="notifications-outline" size={21} color="#FFFFFF" />
              {(unread.data?.notifications ?? 0) > 0 ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
            </Pressable>
          </View>

          <View style={[styles.statusCard, { borderColor: online ? `${ONLINE}88` : 'rgba(255,255,255,0.14)' }]}>
            <View style={[styles.pulse, { backgroundColor: online ? `${ONLINE}33` : 'rgba(255,255,255,0.08)' }]}>
              <View style={[styles.pulseDot, { backgroundColor: online ? ONLINE : '#8A98A8' }]} />
            </View>
            <View style={{ flex: 1 }}>
              <T size="lg" weight="800" color={online ? ONLINE : '#FFFFFF'}>{(online ? t('driver.online') : t('driver.offline')).toUpperCase()}</T>
              <T size="sm" color="#C4D2E0">
                {verified ? (online ? t('driver.onlineHint') : t('driver.offlineHint')) : t(`driver.status.${(d?.status ?? 'pending_review') as 'verified'}` as TranslationKey)}
              </T>
            </View>
            {verified ? (
              <Switch value={online} onValueChange={toggle} trackColor={{ true: ONLINE, false: '#3A4A5E' }} thumbColor="#FFFFFF"
                accessibilityLabel={online ? t('driver.online') : t('driver.offline')} />
            ) : null}
          </View>

          <View style={styles.kpis}>
            <Kpi icon="cash-outline" tint={ONLINE} value={money(today.data?.earnedToday ?? 0)} label={t('driver.earnedToday')} />
            <Kpi icon="checkmark-done" tint={TURQUOISE} value={String(today.data?.deliveredToday ?? 0)} label={t('driver.deliveredToday')} />
            <Kpi icon="wallet-outline" tint={AMBER} value={money(today.data?.balance ?? 0)} label={t('driver.balanceLabel')} />
          </View>
        </View>

        <View style={styles.body}>
          {!d ? <Button title={t('driver.completeFile')} icon="document-text-outline" onPress={() => router.push('/driver-signup')} /> : null}
          {d && !verified ? <Notice text={t('err.DRIVER_NOT_VERIFIED')} /> : null}
          {locError ? <Notice tone="warning" text={t('driver.locationDenied')} /> : null}
          {verified && !fullScreenOk ? (
            <View style={{ gap: spacing.sm }}>
              <Notice tone="warning" text={t('driver.fullScreen.hint')} />
              <Button title={t('driver.fullScreen.allow')} icon="call-outline" variant="secondary" onPress={() => incomingCall.openSettings()} />
            </View>
          ) : null}

          {/* Courses disponibles */}
          <Pressable onPress={() => router.push('/driver/offers')} accessibilityRole="button"
            style={({ pressed }) => [styles.cta, { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 }]}>
            <View style={styles.ctaIcon}><Ionicons name="flash" size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <T size="lg" weight="800" color="#FFFFFF">{t('driver.seeRuns')}</T>
              <T size="xs" color="#FFE3E6">{online ? t('driver.availableRunsHint') : t('driver.offlineHint')}</T>
            </View>
            {offerCount ? <View style={styles.ctaBadge}><T weight="800" color={colors.primary}>{offerCount}</T></View>
              : <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />}
          </Pressable>

          {/* Courses en cours */}
          {(active.data ?? []).map((a) => (
            <Pressable key={a.id} onPress={() => router.push(`/driver/mission/${a.order_id}`)} accessibilityRole="button"
              style={({ pressed }) => [styles.mission, { backgroundColor: colors.surface, borderColor: TURQUOISE, opacity: pressed ? 0.92 : 1 }]}>
              <View style={styles.missionHead}>
                <View style={[styles.missionTag, { backgroundColor: `${TURQUOISE}1F` }]}>
                  <MaterialCommunityIcons name="moped" size={16} color={TURQUOISE} />
                  <T size="xs" weight="800" color={TURQUOISE}>{t('driver.currentRun').toUpperCase()}</T>
                </View>
                <T weight="800">{a.orders?.order_number}</T>
              </View>
              <View style={styles.leg}>
                <View style={[styles.legDot, { backgroundColor: colors.accent2 }]} />
                <View style={{ flex: 1 }}>
                  <T size="xs" muted>{t('driver.pickup')}</T>
                  <T weight="700" numberOfLines={1}>{a.orders?.stores?.name ?? '—'}</T>
                </View>
              </View>
              <View style={[styles.legLine, { backgroundColor: colors.border }]} />
              <View style={styles.leg}>
                <View style={[styles.legDot, { backgroundColor: colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <T size="xs" muted>{t('driver.dropoff')}</T>
                  <T weight="700" numberOfLines={1}>{a.orders?.delivery_address?.commune ?? '—'}</T>
                </View>
              </View>
              <View style={styles.missionFoot}>
                <T size="sm" weight="700" color={colors.primary} style={{ flex: 1 }}>{a.orders ? t(`status.${a.orders.status}` as TranslationKey) : ''}</T>
                {a.eta_minutes ? <T size="sm" muted>{t('orders.eta', { min: a.eta_minutes })}</T> : null}
              </View>
              <View style={[styles.continue, { backgroundColor: TURQUOISE }]}>
                <T weight="800" color="#FFFFFF">{t('driver.continueRun')}</T>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </View>
            </Pressable>
          ))}

          {/* Raccourcis */}
          <T size="lg" weight="800">{t('driver.actions')}</T>
          <View style={styles.grid}>
            <Tile icon="time-outline" tint={VIOLET} title={t('driver.history')} subtitle={t('driver.historyHint')} onPress={() => router.push('/driver/history')} />
            <Tile icon="wallet-outline" tint={colors.accent2} title={t('driver.earnings')} subtitle={t('driver.earningsHint')} onPress={() => router.push('/driver/earnings')} />
            <Tile icon="id-card-outline" tint={AMBER} title={t('driver.card')} subtitle={t('driver.cardHint')} onPress={() => router.push('/driver/card')} />
            <Tile icon="chatbubbles-outline" tint={colors.primary} title={t('inbox.title')} subtitle={t('driver.messagesHint')} badge={unread.data?.messages ?? 0} onPress={() => router.push('/support')} />
          </View>

          <View style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent2} />
            <T size="sm" muted style={{ flex: 1, lineHeight: 19 }}>{t('driver.balanceNote')}</T>
          </View>

          <Button title={t('auth.signOut')} variant="ghost" icon="log-out-outline" onPress={() => signOut().then(() => router.replace('/'))} />
          <AppFooter />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  dot: { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: NAVY },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, backgroundColor: 'rgba(255,255,255,0.06)' },
  pulse: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pulseDot: { width: 14, height: 14, borderRadius: 7 },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, borderRadius: radius.md, padding: spacing.md, gap: 4, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  kpiIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  body: { padding: spacing.lg, gap: spacing.lg },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 64,
    shadowColor: '#E60024', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  ctaIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  ctaBadge: { minWidth: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  mission: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  missionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  missionTag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legDot: { width: 12, height: 12, borderRadius: 6 },
  legLine: { width: 2, height: 12, marginLeft: 5 },
  missionFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  continue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: 4, minHeight: 118 },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  tileIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  note: { flexDirection: 'row', gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, alignItems: 'flex-start' },
});
