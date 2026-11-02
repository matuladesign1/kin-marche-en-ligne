import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { MapBlock } from '@/components/Map';
import { Button, Card, EmptyState, ErrorState, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { useAddresses, useCart, useRecommendedStores, useStores } from '@/hooks/data';
import { useSettings } from '@/providers/SettingsProvider';

function mapsUrl(lat: number, lng: number) {
  return Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export default function Stores() {
  const { t, money, colors, selectedStoreId, setSelectedStoreId } = useSettings();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  const addresses = useAddresses();
  const cart = useCart();
  const defaultAddr = addresses.data?.[0];

  const lat = coords?.lat ?? defaultAddr?.latitude ?? null;
  const lng = coords?.lng ?? defaultAddr?.longitude ?? null;
  // Si le panier contient des produits, on recommande le magasin qui les a réellement en stock.
  const productIds = cart.data?.lines.map((l) => l.item?.product_id).filter((x): x is string => !!x) ?? null;
  const recommended = useRecommendedStores({ lat, lng, commune: defaultAddr?.commune ?? null, productIds: productIds?.length ? productIds : null });
  const stores = useStores();

  const locate = async () => {
    setLocating(true);
    setDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } finally {
      setLocating(false);
    }
  };

  if (recommended.isLoading || stores.isLoading) return <Loading />;
  if (recommended.error) return <ErrorState message={t('common.error')} onRetry={recommended.refetch} />;
  const list = recommended.data ?? [];

  return (
    <Screen>
      <Button title={t('stores.useLocation')} icon="locate-outline" variant="ghost" loading={locating} onPress={locate} />
      {denied ? <Notice tone="warning" text={t('stores.locationDenied')} /> : null}
      <MapBlock
        points={[
          ...list.filter((s) => s.latitude != null && s.longitude != null).map((s) => ({
            id: s.store_id, latitude: s.latitude!, longitude: s.longitude!, title: s.name,
            description: s.can_deliver ? t('stores.canDeliver') : t('stores.cannotDeliver'),
            color: s.can_deliver ? colors.success : colors.primary,
            onPress: () => { setSelectedStoreId(s.store_id); router.back(); },
          })),
          ...(lat != null && lng != null ? [{ id: 'me', latitude: lat, longitude: lng, title: t('home.deliverTo'), color: colors.accent }] : []),
        ]}
      />
      {list.length === 0 ? <EmptyState icon="storefront-outline" message={t('home.noStores')} /> : null}
      {list.map((s) => {
        const full = stores.data?.find((x) => x.id === s.store_id);
        const selected = s.store_id === selectedStoreId;
        return (
          <Card key={s.store_id} style={selected ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T weight="700" style={{ flex: 1 }}>{s.name}</T>
              <T size="sm" color={s.is_open ? colors.success : colors.danger}>{s.is_open ? t('stores.open') : t('stores.closed')}</T>
            </Row>
            <T size="sm" muted>
              {s.address_verified && full
                ? [full.avenue && `${full.avenue} ${full.street_number ?? ''}`.trim(), full.quartier, full.commune, full.city].filter(Boolean).join(', ')
                : t('stores.addressToVerify')}
            </T>
            {full?.landmark ? <T size="xs" muted>{full.landmark}</T> : null}
            <Row style={{ flexWrap: 'wrap' }} gap={12}>
              {s.distance_km != null ? <T size="sm">{t('stores.km', { km: s.distance_km })}</T> : null}
              <T size="sm">{t('checkout.deliveryFee')} : {money(s.delivery_fee_usd)}</T>
              <T size="sm">{t('stores.prep', { min: s.avg_prep_minutes })}</T>
            </Row>
            {lat != null || defaultAddr ? (
              <Row gap={6}>
                <Ionicons name={s.can_deliver ? 'checkmark-circle' : 'close-circle'} size={16} color={s.can_deliver ? colors.success : colors.textMuted} />
                <T size="sm" color={s.can_deliver ? colors.success : colors.textMuted}>{s.can_deliver ? t('stores.canDeliver') : t('stores.cannotDeliver')}</T>
                {s.requested_count > 0 ? <T size="sm" muted>· {s.available_count}/{s.requested_count}</T> : null}
              </Row>
            ) : null}
            {full?.phone ? <T size="sm" muted>☎ {full.phone}</T> : null}
            <Row>
              <Button
                style={{ flex: 1 }}
                title={selected ? t('stores.selected') : t('stores.select')}
                variant={selected ? 'secondary' : 'primary'}
                onPress={() => { setSelectedStoreId(s.store_id); router.back(); }}
              />
              {s.latitude != null && s.longitude != null ? (
                <Button title={t('stores.openMaps')} variant="ghost" icon="navigate-outline" onPress={() => Linking.openURL(mapsUrl(s.latitude!, s.longitude!))} />
              ) : null}
            </Row>
          </Card>
        );
      })}
      {selectedStoreId ? <Button title={t('common.seeAll')} variant="ghost" onPress={() => { setSelectedStoreId(null); router.back(); }} /> : null}
    </Screen>
  );
}
