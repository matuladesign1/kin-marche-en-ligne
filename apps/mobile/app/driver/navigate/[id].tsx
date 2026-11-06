import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KinMap, type KinMarker } from '@/components/KinMap';
import { Loading, T } from '@/components/ui';
import { bearingDeg, distanceM, isLatLng, type LatLng } from '@/lib/geo';
import { alongOf, formatDistance, instruction, maneuverIcon, progressOn, type NavStep, type RouteResult } from '@/lib/navigation';
import { decodePolyline } from '@/lib/polyline';
import { supabase, unwrap } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

// Navigation guidée du livreur, dans l'application (sans Google Maps) : la carte suit le livreur,
// la prochaine manœuvre s'affiche en haut, la distance et le temps restants en bas.
// L'itinéraire (routes OpenStreetMap) est recalculé dès que le livreur s'écarte du tracé.

const TO_STORE = ['driver_assigned', 'driver_to_store'];
const REROUTE_M = 45;
const REFRESH_MS = 60_000;
const ARRIVED_M = 35;

export default function Navigate() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, colors } = useSettings();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [nav, setNav] = useState<{ coords: LatLng[]; steps: NavStep[]; target: 'store' | 'customer'; speed: number } | null>(null);
  const [routeError, setRouteError] = useState(false);
  const lastRoute = useRef(0);
  const offCount = useRef(0);
  const prev = useRef<LatLng | null>(null);

  const q = useQuery({
    queryKey: ['navigate', id],
    queryFn: async () => unwrap(await supabase.from('orders')
      .select('id, order_number, status, delivery_address, stores(name, phone, latitude, longitude)')
      .eq('id', id).maybeSingle()) as {
        id: string; order_number: string; status: string; delivery_address: Record<string, string | number | null>;
        stores: { name: string; phone: string | null; latitude: number | null; longitude: number | null } | null;
      } | null,
    refetchInterval: 30_000,
  });

  // Nouvelle position partagée par le client, nouvelle étape : mise à jour immédiate.
  useEffect(() => {
    const ch = supabase.channel(`nav-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ['navigate', id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  // GPS précis, chaque seconde.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let stop = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGpsDenied(true); return; }
      const s = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 },
        (p) => {
          const here = { latitude: p.coords.latitude, longitude: p.coords.longitude };
          const before = prev.current;
          let h: number | null = p.coords.heading != null && p.coords.heading >= 0 && (p.coords.speed ?? 0) > 1.5 ? p.coords.heading : null;
          if (h == null && before && distanceM(before, here) > 5) h = bearingDeg(before, here);
          if (h != null) setHeading(h);
          prev.current = here;
          setPos(here);
        },
      );
      if (stop) s.remove(); else sub = s;
    })();
    return () => { stop = true; sub?.remove(); };
  }, []);

  const fetchRoute = useCallback(async (origin: LatLng | null) => {
    if (Date.now() - lastRoute.current < 5_000) return;
    lastRoute.current = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke('delivery-eta', {
        body: { order_id: id, force: true, steps: true, origin: origin ? { lat: origin.latitude, lng: origin.longitude } : undefined },
      });
      if (error) throw error;
      const r = data as RouteResult;
      if (r.skipped) return;
      const coords = decodePolyline(r.route_polyline);
      if (coords.length < 2) throw new Error('NO_ROUTE');
      const km = r.total_km ?? 0, min = r.total_minutes ?? 0;
      setNav({ coords, steps: r.steps ?? [], target: r.target ?? 'customer', speed: km > 0 && min > 0 ? (km * 1000) / (min * 60) : 6 });
      setRouteError(false);
    } catch {
      setRouteError(true);
      lastRoute.current = Date.now() - 2_000;   // nouvel essai dans quelques secondes
    }
  }, [id]);

  const status = q.data?.status;
  const hasFix = !!pos;
  // Premier itinéraire dès la première position, puis à chaque nouvelle étape (magasin → client).
  useEffect(() => { if (status) fetchRoute(prev.current); }, [status, hasFix, fetchRoute]);
  useEffect(() => {
    const timer = setInterval(() => fetchRoute(prev.current), REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchRoute]);
  // Livreur sorti du tracé : nouvel itinéraire (après 3 positions de suite hors du tracé).
  const progress = useMemo(() => (pos && nav ? progressOn(pos, nav.coords, nav.steps) : null), [pos, nav]);
  useEffect(() => {
    if (!progress) return;
    if (progress.offRoute > REROUTE_M) {
      offCount.current += 1;
      if (offCount.current >= 3) { offCount.current = 0; fetchRoute(prev.current); }
    } else offCount.current = 0;
  }, [progress, fetchRoute]);

  if (q.isLoading) return <Loading />;
  const order = q.data;
  if (!order) return <Loading />;
  const toStore = TO_STORE.includes(order.status);
  const store = order.stores;
  const addr = order.delivery_address ?? {};
  const storePt = store?.latitude != null ? { latitude: store.latitude, longitude: store.longitude! } : null;
  const homePt = addr.latitude != null ? { latitude: Number(addr.latitude), longitude: Number(addr.longitude) } : null;
  const dest = toStore ? storePt : homePt;
  const arrived = !!(pos && dest && isLatLng(dest) && distanceM(pos, dest) < ARRIVED_M);

  // Distance et temps jusqu'à la destination en cours (le magasin d'abord, si c'est l'étape).
  let remaining = progress?.remaining ?? null;
  if (progress && nav && toStore) {
    const stop = nav.steps.find((s) => s.type === 'arrive' && (s.leg ?? 0) === 0);
    if (stop) remaining = Math.max(0, alongOf(stop, nav.coords) - progress.along);
  }
  const minutes = remaining != null && nav ? Math.max(1, Math.round(remaining / nav.speed / 60)) : null;
  const arrivalAt = minutes != null ? new Date(Date.now() + minutes * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const next = progress?.next ?? null;
  const nextText = !next ? t('nav.depart')
    : next.type === 'arrive' ? ((next.leg ?? 0) === 0 && nav?.target === 'store' ? t('nav.arriveStore') : t('nav.arrive'))
    : instruction(next, t);
  const phone = toStore ? store?.phone : (addr.recipient_phone as string | null);
  const destName = toStore ? t('nav.toStore', { name: store?.name ?? '' }) : t('nav.toClient', { name: String(addr.recipient_name ?? '') });

  const markers: KinMarker[] = [
    ...(storePt ? [{ id: 'store', ...storePt, kind: 'store' as const, label: store?.name, active: toStore }] : []),
    ...(homePt ? [{ id: 'home', ...homePt, kind: 'home' as const, label: String(addr.recipient_name ?? t('driver.client')), active: !toStore }] : []),
    ...(pos ? [{ id: 'me', ...pos, kind: 'driver' as const, heading }] : []),
  ];

  const openGoogle = () => {
    if (!dest) return;
    const url = Platform.OS === 'android' ? `google.navigation:q=${dest.latitude},${dest.longitude}&mode=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}&travelmode=driving`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}`));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KinMap markers={markers} route={nav?.coords} follow={pos} followZoom={17} rounded={false} style={{ borderWidth: 0 }} />

      {/* Prochaine manœuvre */}
      <View style={[styles.banner, { top: insets.top + 8, backgroundColor: arrived ? '#13A35F' : '#0F5132' }]}>
        <MaterialCommunityIcons name={(arrived ? 'flag-checkered' : maneuverIcon(next)) as keyof typeof MaterialCommunityIcons.glyphMap} size={40} color="#FFFFFF" />
        <View style={{ flex: 1, gap: 2 }}>
          {gpsDenied ? (
            <T weight="700" color="#FFFFFF">{t('nav.gpsOff')}</T>
          ) : arrived ? (
            <T size="lg" weight="800" color="#FFFFFF">{toStore ? t('nav.arriveStore') : t('nav.arrive')}</T>
          ) : !nav ? (
            <T weight="700" color="#FFFFFF">{routeError ? t('nav.noRoute') : t('nav.computing')}</T>
          ) : (
            <>
              {next ? <T size="xl" weight="800" color="#FFFFFF">{formatDistance(progress?.toNext ?? 0, t)}</T> : null}
              <T weight="700" color="#FFFFFF" numberOfLines={2}>{nextText}</T>
            </>
          )}
        </View>
      </View>

      {/* Destination, distance et temps restants */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 12, backgroundColor: colors.surface }]}>
        <Row2>
          <Ionicons name={toStore ? 'storefront' : 'home'} size={22} color={toStore ? colors.primary : colors.accent} />
          <T weight="800" numberOfLines={1} style={{ flex: 1 }}>{destName}</T>
        </Row2>
        {remaining != null && minutes != null && !arrived ? (
          <T size="lg" weight="800" color="#13A35F">{t('nav.remaining', { d: formatDistance(remaining, t), min: minutes, time: arrivalAt })}</T>
        ) : null}
        <View style={styles.actions}>
          {phone ? <Action icon="call" label={t('common.call')} onPress={() => Linking.openURL(`tel:${phone}`)} /> : null}
          <Action icon="logo-google" label={t('nav.googleMaps')} onPress={openGoogle} />
          <Action icon={arrived ? 'checkmark-circle' : 'close'} label={arrived ? t('nav.backToMission') : t('nav.quit')} primary={arrived}
            onPress={() => (router.canGoBack() ? router.back() : router.replace(`/driver/mission/${id}`))} />
        </View>
        <T size="xs" muted>{t('nav.source')}</T>
      </View>
    </View>
  );
}

function Row2({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{children}</View>;
}

function Action({ icon, label, onPress, primary }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.action, { backgroundColor: primary ? '#13A35F' : colors.surfaceAlt, opacity: pressed ? 0.8 : 1 }]}>
      <Ionicons name={icon} size={18} color={primary ? '#FFFFFF' : colors.text} />
      <T size="xs" weight="700" color={primary ? '#FFFFFF' : colors.text} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 14, gap: 8,
    elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: -2 },
  },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 6 },
});
