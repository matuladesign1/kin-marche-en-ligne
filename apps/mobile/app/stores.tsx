import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { KinMap } from '@/components/KinMap';
import { StoreRoute, type RouteOrigin, type RouteStore } from '@/components/StoreRoute';
import { Button, EmptyState, ErrorState, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useAddresses, useCart, useRecommendedStores, useStores } from '@/hooks/data';
import type { LatLng } from '@/lib/geo';
import { currentPosition } from '@/lib/location';
import { radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

export default function Stores() {
  const { t, money, colors, selectedStoreId, setSelectedStoreId } = useSettings();
  const [gps, setGps] = useState<LatLng | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<RouteOrigin | null>(null);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const addresses = useAddresses();
  const cart = useCart();
  const defaultAddr = addresses.data?.[0];
  const addrPoint: LatLng | null = defaultAddr?.latitude != null && defaultAddr?.longitude != null
    ? { latitude: Number(defaultAddr.latitude), longitude: Number(defaultAddr.longitude) } : null;
  const addrOrigin: RouteOrigin | null = addrPoint ? { point: addrPoint, kind: 'address', label: defaultAddr?.label } : null;

  // Position du client : GPS si disponible, sinon l'adresse enregistrée (frais et zone de livraison calculés pour ce point).
  const point = gps ?? routeOrigin?.point ?? addrPoint;
  const lat = point?.latitude ?? null;
  const lng = point?.longitude ?? null;
  // Si le panier contient des produits, on recommande le magasin qui les a réellement en stock.
  const productIds = cart.data?.lines.map((l) => l.item?.product_id).filter((x): x is string => !!x) ?? null;
  const recommended = useRecommendedStores({ lat, lng, commune: defaultAddr?.commune ?? null, productIds: productIds?.length ? productIds : null });
  const stores = useStores();

  const locate = async () => {
    setLocating(true);
    setDenied(false);
    setNotFound(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      const pos = await currentPosition(Location.Accuracy.Balanced);
      if (!pos) { setNotFound(true); return; }
      setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      setNotFound(true);
    } finally {
      setLocating(false);
    }
  };

  const choose = (id: string | null) => { setSelectedStoreId(id); router.back(); };

  if ((recommended.isLoading && !recommended.data) || stores.isLoading) return <Loading />;
  if (recommended.error) return <ErrorState message={t('common.error')} onRetry={recommended.refetch} />;
  const list = recommended.data ?? [];
  const onMap = (stores.data ?? []).filter((x) => x.latitude != null && x.longitude != null);

  // Magasin dont on affiche l'itinéraire.
  const rs = list.find((s) => s.store_id === routeFor);
  const rf = stores.data?.find((x) => x.id === routeFor);
  const routeStore: RouteStore | null = routeFor && rf?.latitude != null && rf.longitude != null ? {
    id: rf.id, name: rf.name, latitude: rf.latitude, longitude: rf.longitude, phone: rf.phone, isOpen: rs?.is_open ?? rf.is_open,
    fee: rs?.delivery_fee_usd ?? rf.delivery_fee_usd, prep: rs?.avg_prep_minutes ?? rf.avg_prep_minutes, canDeliver: point ? rs?.can_deliver ?? null : null,
  } : null;
  const origin: RouteOrigin | null = gps ? { point: gps, kind: 'gps' } : routeOrigin ?? addrOrigin;

  return (
    <Screen>
      {/* Position utilisée pour les frais, la zone de livraison et les itinéraires. */}
      <View style={[styles.posBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.posIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name={gps ? 'navigate' : addrPoint ? 'home' : 'location-outline'} size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <T size="xs" muted>{t('stores.yourPosition')}</T>
          <T weight="700" numberOfLines={1}>
            {gps ? t('stores.positionGps') : addrPoint ? t('stores.positionAddress', { label: defaultAddr?.label ?? '' }) : t('stores.positionNone')}
          </T>
        </View>
        <Button title={gps ? t('stores.refresh') : t('stores.useLocation')} icon="locate-outline" variant="ghost" loading={locating} onPress={locate}
          style={styles.posBtn} />
      </View>
      {denied ? <Notice tone="warning" text={t('stores.locationDenied')} /> : null}
      {notFound ? <Notice tone="warning" text={t('stores.locationUnavailable')} /> : null}

      {/* Tous les points de vente Kin Marché sur notre carte ; toucher un magasin ouvre son itinéraire. */}
      <View style={{ gap: 6 }}>
        <KinMap
          height={300}
          cooperative
          showLabels
          fitKey={`${list.length}-${lat ?? ''}`}
          markers={[
            ...onMap.map((x) => {
              const r = list.find((s) => s.store_id === x.id);
              return {
                id: x.id, latitude: x.latitude!, longitude: x.longitude!, kind: 'store' as const, label: x.name,
                color: r?.can_deliver === false && point ? colors.textMuted : undefined,
                active: x.id === selectedStoreId,
                onPress: () => setRouteFor(x.id),
              };
            }),
            ...(point ? [{ id: 'me', latitude: point.latitude, longitude: point.longitude, kind: gps ? 'me' as const : 'home' as const, label: t('route.you') }] : []),
          ]}
        />
        <T size="xs" muted>{t('stores.mapHint', { n: onMap.length })}</T>
      </View>

      {list.length === 0 ? <EmptyState icon="storefront-outline" message={t('home.noStores')} /> : null}
      {list.map((s) => {
        const full = stores.data?.find((x) => x.id === s.store_id);
        const selected = s.store_id === selectedStoreId;
        const address = s.address_verified && full
          ? [full.avenue && `${full.avenue} ${full.street_number ?? ''}`.trim(), full.quartier, full.commune, full.city].filter(Boolean).join(', ')
          : t('stores.addressToVerify');
        const canRoute = s.latitude != null && s.longitude != null;
        return (
          <View key={s.store_id} style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}>
            <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
              <View style={[styles.storeIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="storefront" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Row gap={6}>
                  <T weight="800" size="lg" numberOfLines={1} style={{ flexShrink: 1 }}>{s.name}</T>
                  {s.address_verified ? <VerifiedBadge size={15} color={colors.accent} /> : null}
                </Row>
                <T size="sm" muted numberOfLines={2}>{address}</T>
                {full?.landmark ? <T size="xs" muted numberOfLines={1}>{full.landmark}</T> : null}
              </View>
              <View style={[styles.pill, { backgroundColor: (s.is_open ? colors.success : colors.danger) + '22' }]}>
                <T size="xs" weight="700" color={s.is_open ? colors.success : colors.danger}>{s.is_open ? t('stores.open') : t('stores.closed')}</T>
              </View>
            </Row>

            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {s.distance_km != null ? <Info icon="navigate-outline" text={t('stores.km', { km: String(s.distance_km).replace('.', ',') })} /> : null}
              <Info icon="moped" mci text={t('stores.feeShort', { fee: money(s.delivery_fee_usd) })} />
              <Info icon="time-outline" text={t('stores.prep', { min: s.avg_prep_minutes })} />
            </Row>

            {point ? (
              <Row gap={6}>
                <Ionicons name={s.can_deliver ? 'checkmark-circle' : 'close-circle'} size={16} color={s.can_deliver ? colors.success : colors.textMuted} />
                <T size="sm" weight="600" color={s.can_deliver ? colors.success : colors.textMuted}>{s.can_deliver ? t('stores.canDeliver') : t('stores.cannotDeliver')}</T>
                {s.requested_count > 0 ? <T size="sm" muted>· {t('stores.inStock', { n: s.available_count, total: s.requested_count })}</T> : null}
              </Row>
            ) : null}

            <Row gap={10}>
              <Button style={{ flex: 1 }} title={selected ? t('stores.selected') : t('stores.select')}
                icon={selected ? 'checkmark-circle' : 'storefront-outline'} variant={selected ? 'secondary' : 'primary'}
                onPress={() => choose(s.store_id)} />
              <Button style={{ flex: 1 }} title={t('stores.openMaps')} icon="navigate-outline" variant="ghost" disabled={!canRoute}
                onPress={() => setRouteFor(s.store_id)} />
            </Row>
            {full?.phone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${full.phone}`)} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
                <Row gap={6}>
                  <Ionicons name="call-outline" size={15} color={colors.primary} />
                  <T size="sm" weight="600" color={colors.primary}>{full.phone}</T>
                </Row>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {selectedStoreId ? (
        <Button title={t('stores.showAll')} icon="apps-outline" variant="ghost" onPress={() => choose(null)} />
      ) : null}

      <StoreRoute
        store={routeStore}
        origin={origin}
        fallback={addrOrigin}
        selected={!!routeFor && routeFor === selectedStoreId}
        onClose={() => setRouteFor(null)}
        onChoose={() => { const id = routeFor; setRouteFor(null); choose(id); }}
        onOrigin={(o) => { if (o.kind === 'gps') setGps(o.point); else setRouteOrigin(o); }}
      />
    </Screen>
  );
}

function Info({ icon, text, mci }: { icon: string; text: string; mci?: boolean }) {
  const { colors } = useSettings();
  return (
    <View style={[styles.info, { backgroundColor: colors.surfaceAlt }]}>
      {mci
        ? <MaterialCommunityIcons name={icon as keyof typeof MaterialCommunityIcons.glyphMap} size={14} color={colors.textMuted} />
        : <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={13} color={colors.textMuted} />}
      <T size="xs" weight="600">{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  posBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, paddingLeft: spacing.md },
  posIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  posBtn: { minHeight: 40, paddingHorizontal: 12 },
  card: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  storeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  info: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
});
