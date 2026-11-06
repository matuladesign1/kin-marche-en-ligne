import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Easing, Modal, Pressable, StyleSheet, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Offer } from '@/hooks/driver';
import { errorMessage } from '@/lib/errors';
import { incomingCall } from '@/lib/kincall';
import { supabase, unwrap } from '@/lib/supabase';
import { spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';
import { T } from './ui';

// Nouvelle course proposée au livreur : écran plein comme un appel entrant (sonnerie du canal « missions_appel »,
// vibration continue), avec « Accepter » et « Refuser ». S'affiche dès qu'une offre arrive application ouverte,
// et à chaque retour dans l'application tant qu'une offre attend une réponse.

const listeners = new Set<() => void>();
/** Demande l'affichage de l'appel (offre reçue en direct, voir useLiveNotifications). */
export function showMissionCall(): void {
  listeners.forEach((l) => l());
}

const NAVY = '#0E1E33';
const GREEN = '#22C55E';
const RED = '#EF4444';
const TURQUOISE = '#1CB7B8';

function Pulse({ delay }: { delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  return (
    <Animated.View style={[styles.ring, {
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) }],
    }]} />
  );
}

export function MissionCall() {
  const { profile } = useAuth();
  const { t, money } = useSettings();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const isDriver = profile?.role === 'driver';

  // Cherche une offre en attente (la plus récente encore valable).
  const check = useCallback(async () => {
    if (!isDriver) return;
    const { data } = await supabase.rpc('get_driver_offers');
    const list = ((data ?? []) as Offer[]).filter((o) => new Date(o.expires_at).getTime() > Date.now());
    setOffer((cur) => (cur && list.some((o) => o.assignment_id === cur.assignment_id) ? cur : list[0] ?? null));
  }, [isDriver]);

  useEffect(() => {
    if (!isDriver) { setOffer(null); return; }
    listeners.add(check);
    const h = setTimeout(check, 3500);   // après l'animation d'ouverture
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { listeners.delete(check); clearTimeout(h); sub.remove(); };
  }, [isDriver, check]);

  // Vibration continue et compte à rebours tant que l'appel est affiché.
  useEffect(() => {
    if (!offer) return;
    Vibration.vibrate([0, 900, 700], true);
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { Vibration.cancel(); clearInterval(tick); };
  }, [offer]);

  const left = offer ? Math.max(0, Math.round((new Date(offer.expires_at).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (offer && left === 0) { setOffer(null); incomingCall.cancel(); Notifications.dismissAllNotificationsAsync().catch(() => undefined); check(); }
  }, [offer, left, check]);

  if (!offer) return null;

  const respond = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    Vibration.cancel();
    incomingCall.cancel();                                                 // arrête l'appel plein écran
    Notifications.dismissAllNotificationsAsync().catch(() => undefined);   // arrête la sonnerie
    try {
      const r = unwrap(await supabase.rpc('respond_to_offer', { p_assignment_id: offer.assignment_id, p_accept: accept, p_reason: null })) as { ok: boolean };
      qc.invalidateQueries({ queryKey: ['driver-offers'] });
      qc.invalidateQueries({ queryKey: ['driver-active'] });
      setOffer(null);
      if (accept && r.ok) router.push(`/driver/mission/${offer.order_id}`);
      else if (accept) Alert.alert(t('driver.offers'), t('err.OFFER_NOT_PENDING'));
      else check();
    } catch (e) {
      setOffer(null);
      Alert.alert(t('driver.offers'), errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent={false} animationType="slide" statusBarTranslucent onRequestClose={() => undefined}>
      <StatusBar style="light" />
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <T size="sm" weight="800" color="#8FB3C9">{t('driver.call.label').toUpperCase()}</T>
          <T size="xxl" weight="800" color="#FFFFFF" style={{ textAlign: 'center' }}>{t('driver.call.title')}</T>
          <View style={[styles.timer, { backgroundColor: left < 30 ? RED : 'rgba(255,255,255,0.12)' }]}>
            <Ionicons name="timer-outline" size={16} color="#FFFFFF" />
            <T weight="800" color="#FFFFFF">{t('driver.expiresIn', { s: left })}</T>
          </View>
        </View>

        <View style={styles.center}>
          <Pulse delay={0} /><Pulse delay={530} /><Pulse delay={1060} />
          <View style={styles.avatar}><MaterialCommunityIcons name="moped" size={58} color="#FFFFFF" /></View>
        </View>

        <View style={styles.card}>
          <View style={styles.leg}>
            <View style={[styles.dot, { backgroundColor: TURQUOISE }]} />
            <View style={{ flex: 1 }}>
              <T size="xs" color="#AFC0D3">{t('driver.pickup')}</T>
              <T size="lg" weight="800" color="#FFFFFF" numberOfLines={1}>{offer.store_name}</T>
              {offer.store_commune ? <T size="sm" color="#C4D2E0">{offer.store_commune}</T> : null}
            </View>
          </View>
          <View style={styles.legLine} />
          <View style={styles.leg}>
            <View style={[styles.dot, { backgroundColor: RED }]} />
            <View style={{ flex: 1 }}>
              <T size="xs" color="#AFC0D3">{t('driver.dropoff')}</T>
              <T size="lg" weight="800" color="#FFFFFF" numberOfLines={1}>{offer.customer_commune ?? '—'}</T>
            </View>
          </View>
          <View style={styles.meta}>
            <T size="sm" color="#C4D2E0" style={{ flex: 1 }}>
              {t('driver.items', { n: offer.items_count, kg: Number(offer.weight_kg).toFixed(1) })}
              {offer.distance_km != null ? ` · ${t('stores.km', { km: offer.distance_km })}` : ''}
            </T>
            <T size="xl" weight="800" color={GREEN}>{money(offer.delivery_fee_usd)}</T>
          </View>
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Pressable onPress={() => respond(false)} disabled={busy} accessibilityRole="button" accessibilityLabel={t('driver.refuse')}
              style={({ pressed }) => [styles.round, { backgroundColor: RED, opacity: pressed || busy ? 0.8 : 1 }]}>
              <MaterialCommunityIcons name="phone-hangup" size={34} color="#FFFFFF" />
            </Pressable>
            <T weight="800" color="#FFFFFF">{t('driver.refuse')}</T>
          </View>
          <View style={styles.action}>
            <Pressable onPress={() => respond(true)} disabled={busy} accessibilityRole="button" accessibilityLabel={t('driver.accept')}
              style={({ pressed }) => [styles.round, { backgroundColor: GREEN, opacity: pressed || busy ? 0.8 : 1 }]}>
              <MaterialCommunityIcons name="phone" size={34} color="#FFFFFF" />
            </Pressable>
            <T weight="800" color="#FFFFFF">{t('driver.accept')}</T>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: NAVY, paddingHorizontal: spacing.xl, justifyContent: 'space-between' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
  center: { alignItems: 'center', justifyContent: 'center', height: 220 },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: GREEN },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: TURQUOISE, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)' },
  card: { borderRadius: 20, padding: spacing.lg, gap: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  leg: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 14, height: 14, borderRadius: 7 },
  legLine: { width: 2, height: 14, marginLeft: 6, backgroundColor: 'rgba(255,255,255,0.25)' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' },
  action: { alignItems: 'center', gap: spacing.sm },
  round: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', elevation: 6 },
});
