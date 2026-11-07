import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KinMap } from '@/components/KinMap';
import { Button, Notice, Row, T } from '@/components/ui';
import type { LatLng } from '@/lib/geo';
import { currentPosition } from '@/lib/location';
import { formatDistance } from '@/lib/navigation';
import { decodePolyline } from '@/lib/polyline';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import type { TranslationKey } from '@/locales/fr';
import { useSettings } from '@/providers/SettingsProvider';

// Itinéraire vers un magasin, directement sur la carte Kin Marché : tracé depuis la position du client,
// distance et durée selon le moyen de transport, prix de la livraison de ce magasin jusqu'au client.

export type RouteMode = 'walk' | 'bike' | 'drive';

export interface RouteStore {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  phone?: string | null;
  isOpen: boolean;
  /** Prix de la livraison jusqu'à la position du client (calculé par le serveur). */
  fee?: number | null;
  prep?: number | null;
  canDeliver?: boolean | null;
}

export interface RouteOrigin {
  point: LatLng;
  kind: 'gps' | 'address';
  label?: string | null;
}

interface RouteResponse { route_polyline: string; distance_m: number; duration_s: number; source: string }

const MODES: { key: RouteMode; label: TranslationKey; icon: (c: string) => ReactNode }[] = [
  { key: 'walk', label: 'route.walk', icon: (c) => <Ionicons name="walk" size={20} color={c} /> },
  { key: 'bike', label: 'route.bike', icon: (c) => <Ionicons name="bicycle" size={20} color={c} /> },
  { key: 'drive', label: 'route.drive', icon: (c) => <MaterialCommunityIcons name="moped" size={21} color={c} /> },
];

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function fetchRoute(storeId: string, origin: LatLng, mode: RouteMode): Promise<RouteResponse> {
  const { data, error } = await supabase.functions.invoke('store-route', {
    body: { store_id: storeId, mode, origin: { lat: origin.latitude, lng: origin.longitude } },
  });
  if (error) {
    // Code d'erreur renvoyé par le serveur (AUTH_REQUIRED, TOO_FAR, RATE_LIMITED…).
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    const body = await ctx?.json?.().catch(() => null);
    throw new Error(body?.error ?? 'ROUTE_FAILED');
  }
  return data as RouteResponse;
}

export function StoreRoute({ store, origin, fallback, selected, onClose, onChoose, onOrigin }: {
  store: RouteStore | null;
  origin: RouteOrigin | null;
  /** Adresse enregistrée, utilisée si le GPS ne répond pas. */
  fallback: RouteOrigin | null;
  selected: boolean;
  onClose: () => void;
  onChoose: () => void;
  onOrigin: (o: RouteOrigin) => void;
}) {
  const { t, colors, money } = useSettings();
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<RouteMode>('drive');
  const [locating, setLocating] = useState(false);
  const [noOrigin, setNoOrigin] = useState(false);

  // Position de départ : GPS du téléphone, sinon l'adresse enregistrée.
  const locate = async () => {
    setLocating(true);
    setNoOrigin(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const pos = status === 'granted' ? await currentPosition(Location.Accuracy.Balanced) : null;
      if (pos) onOrigin({ point: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, kind: 'gps' });
      else if (fallback) onOrigin(fallback);
      else setNoOrigin(true);
    } catch {
      if (fallback) onOrigin(fallback); else setNoOrigin(true);
    } finally {
      setLocating(false);
    }
  };

  // À l'ouverture : position GPS si la localisation est déjà autorisée (sans nouvelle demande),
  // sinon l'adresse enregistrée ; sans adresse, on demande la position.
  useEffect(() => {
    if (!store) return;
    if (!origin) { locate(); return; }
    if (origin.kind !== 'gps') {
      Location.getForegroundPermissionsAsync().then((p) => { if (p.granted) locate(); }).catch(() => undefined);
    }
  }, [store?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = origin ? `${origin.point.latitude.toFixed(4)},${origin.point.longitude.toFixed(4)}` : '';
  const route = useQuery({
    queryKey: ['store-route', store?.id, mode, key],
    enabled: !!store && !!origin && !!session,
    staleTime: 10 * 60_000,
    retry: (n, e) => n < 1 && !['AUTH_REQUIRED', 'TOO_FAR', 'RATE_LIMITED', 'STORE_NO_POSITION'].includes((e as Error).message),
    queryFn: () => fetchRoute(store!.id, origin!.point, mode),
  });

  if (!store) return null;
  const coords = decodePolyline(route.data?.route_polyline);
  const seconds = route.data?.duration_s ?? 0;
  const minutes = Math.max(1, Math.round(seconds / 60));
  const duration = minutes < 60 ? t('route.min', { n: minutes })
    : t('route.hmin', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') });
  const errCode = (route.error as Error | null)?.message;

  return (
    <Modal visible animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <T size="xs" muted>{t('stores.openMaps')}</T>
            <T size="lg" weight="800" numberOfLines={1}>{store.name}</T>
          </View>
          <View style={[styles.pill, { backgroundColor: (store.isOpen ? colors.success : colors.danger) + '22' }]}>
            <T size="xs" weight="700" color={store.isOpen ? colors.success : colors.danger}>{store.isOpen ? t('stores.open') : t('stores.closed')}</T>
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <KinMap
            rounded={false}
            style={{ borderWidth: 0 }}
            showLabels
            fitKey={`${mode}-${coords.length}-${key}`}
            route={coords}
            markers={[
              { id: 'store', latitude: store.latitude, longitude: store.longitude, kind: 'store', label: store.name, active: true },
              ...(origin ? [{ id: 'me', latitude: origin.point.latitude, longitude: origin.point.longitude, kind: origin.kind === 'gps' ? 'me' as const : 'home' as const, label: t('route.you') }] : []),
            ]}
          />
          {route.isFetching || locating ? (
            <View style={[styles.computing, { backgroundColor: colors.surface }]}>
              <ActivityIndicator color={colors.primary} />
              <T size="sm" weight="600">{locating ? t('route.locating') : t('nav.computing')}</T>
            </View>
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={[styles.modes, { backgroundColor: colors.surfaceAlt }]}>
            {MODES.map((m) => {
              const active = m.key === mode;
              const fg = active ? colors.onPrimary : colors.text;
              return (
                <Pressable key={m.key} onPress={() => setMode(m.key)} accessibilityRole="button" accessibilityState={{ selected: active }}
                  style={[styles.mode, active && { backgroundColor: colors.primary }]}>
                  {m.icon(fg)}
                  <T size="sm" weight="700" color={fg} numberOfLines={1}>{t(m.label)}</T>
                </Pressable>
              );
            })}
          </View>

          {!session ? (
            <View style={{ gap: spacing.sm }}>
              <Notice text={t('route.signIn')} />
              <Button title={t('auth.signIn')} icon="log-in-outline" onPress={() => { onClose(); router.push('/(auth)/sign-in'); }} />
            </View>
          ) : noOrigin ? (
            <View style={{ gap: spacing.sm }}>
              <Notice tone="warning" text={t('route.noOrigin')} />
              <Button title={t('stores.useLocation')} icon="locate-outline" variant="secondary" loading={locating} onPress={locate} />
            </View>
          ) : route.data ? (
            <View style={{ gap: 2 }}>
              <Row gap={10} style={{ alignItems: 'flex-end' }}>
                <T size="xxl" weight="800" color={colors.primary}>{duration}</T>
                <T weight="700" style={{ paddingBottom: 3 }}>{formatDistance(route.data.distance_m, t)}</T>
              </Row>
              <T size="sm" muted>
                {t('route.arrival', { time: clock(new Date(Date.now() + seconds * 1000)) })}
                {mode === 'drive' ? ` · ${t('route.noTraffic')}` : ''}
              </T>
            </View>
          ) : route.isError ? (
            <View style={{ gap: spacing.sm }}>
              <Notice tone="warning" text={errCode === 'TOO_FAR' ? t('route.tooFar') : errCode === 'RATE_LIMITED' ? t('route.busy')
                : errCode === 'AUTH_REQUIRED' ? t('route.signIn') : t('route.error')} />
              <Button title={t('common.retry')} icon="refresh" variant="secondary" onPress={() => route.refetch()} />
            </View>
          ) : null}

          {origin ? (
            <Row gap={6}>
              <Ionicons name={origin.kind === 'gps' ? 'navigate-outline' : 'home-outline'} size={14} color={colors.textMuted} />
              <T size="xs" muted style={{ flex: 1 }}>
                {origin.kind === 'gps' ? t('route.fromGps') : t('route.fromAddress', { label: origin.label ?? '' })}
              </T>
              {origin.kind !== 'gps' ? (
                <Pressable onPress={locate} hitSlop={8}><T size="xs" weight="700" color={colors.primary}>{t('stores.useLocation')}</T></Pressable>
              ) : null}
            </Row>
          ) : null}

          <View style={[styles.delivery, { borderColor: colors.border }]}>
            <View style={[styles.deliveryIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="moped" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T size="sm" weight="700">{t('route.delivery')}</T>
              <T size="sm" muted>
                {store.fee != null ? money(store.fee) : '—'}
                {store.prep ? ` · ${t('stores.prep', { min: store.prep })}` : ''}
              </T>
              {store.canDeliver != null && origin ? (
                <T size="xs" weight="600" color={store.canDeliver ? colors.success : colors.textMuted}>
                  {store.canDeliver ? t('stores.canDeliver') : t('stores.cannotDeliver')}
                </T>
              ) : null}
            </View>
          </View>

          <Row gap={10}>
            <Button style={{ flex: 1 }} title={selected ? t('stores.selected') : t('stores.select')}
              icon={selected ? 'checkmark-circle' : 'storefront-outline'} variant={selected ? 'secondary' : 'primary'} onPress={onChoose} />
            {store.phone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${store.phone}`)} accessibilityRole="button" accessibilityLabel={t('route.call')}
                style={[styles.callBtn, { borderColor: colors.border }]}>
                <Ionicons name="call" size={20} color={colors.primary} />
              </Pressable>
            ) : null}
          </Row>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  computing: {
    position: 'absolute', alignSelf: 'center', top: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, elevation: 3,
  },
  sheet: {
    marginTop: -16, borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg, gap: spacing.md, elevation: 8,
  },
  modes: { flexDirection: 'row', borderRadius: radius.md, padding: 4, gap: 4 },
  mode: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radius.sm },
  delivery: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  deliveryIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  callBtn: { width: 52, minHeight: 48, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
