import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Platform, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KinMap } from '@/components/KinMap';
import { Button, Card, Chip, Divider, Input, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatQty } from '@/lib/format';
import { decodePolyline } from '@/lib/polyline';
import { supabase, unwrap } from '@/lib/supabase';
import type { OrderItem, OrderStatus } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const INCIDENTS = ['missing_item', 'damaged_item', 'failed_delivery', 'return', 'accident', 'other'] as const;

function mapsUrl(lat: number, lng: number) {
  return Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Navigation dans Google Maps (en second : la navigation Kin Marché est dans l'application). */
async function startNavigation(lat: number, lng: number, waypoint?: { lat: number; lng: number } | null) {
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${waypoint ? `&waypoints=${waypoint.lat},${waypoint.lng}` : ''}&travelmode=driving`;
  const native = Platform.OS === 'android' && !waypoint ? `google.navigation:q=${lat},${lng}&mode=d` : Platform.OS === 'ios' ? `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving` : null;
  try {
    if (native) { await Linking.openURL(native); return; }
  } catch { /* application Google Maps absente */ }
  await Linking.openURL(web);
}

export default function Mission() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, money, colors, language } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [packageCode, setPackageCode] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [incident, setIncident] = useState<(typeof INCIDENTS)[number] | null>(null);
  const [incidentText, setIncidentText] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);

  const q = useQuery({
    queryKey: ['mission', id],
    queryFn: async () => {
      const order = unwrap(await supabase.from('orders')
        .select('id, order_number, status, delivery_address, delivery_instructions, delivery_fee_usd, store_id, stores(name, phone, latitude, longitude, avenue, commune)')
        .eq('id', id).maybeSingle()) as any;
      const items = (await supabase.from('order_items').select('*').eq('order_id', id)).data as OrderItem[] | null;
      const assignment = (await supabase.from('delivery_assignments')
        .select('id, status, route_polyline, eta_minutes, route_distance_km, eta_target, eta_updated_at')
        .eq('order_id', id).eq('driver_id', session!.user.id).in('status', ['accepted', 'completed']).maybeSingle()).data as {
          id: string; status: string; route_polyline: string | null; eta_minutes: number | null; route_distance_km: number | null;
          eta_target: 'store' | 'customer' | null; eta_updated_at: string | null;
        } | null;
      const me = (await supabase.from('drivers').select('current_latitude, current_longitude').eq('id', session!.user.id).maybeSingle()).data as
        { current_latitude: number | null; current_longitude: number | null } | null;
      return { order, items: items ?? [], assignment, me };
    },
  });

  // Itinéraire réel : calculé à l'ouverture puis toutes les minutes (Google Routes, côté serveur).
  const accepted = q.data?.assignment?.status === 'accepted';
  useEffect(() => {
    if (!accepted) return;
    const refresh = () => supabase.functions.invoke('delivery-eta', { body: { order_id: id, force: true } })
      .then(() => qc.invalidateQueries({ queryKey: ['mission', id] }));
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [accepted, id, qc]);

  // Le client partage sa position exacte ou la commande avance : la carte se met à jour aussitôt.
  useEffect(() => {
    const ch = supabase.channel(`mission-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ['mission', id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  if (q.isLoading) return <Loading />;
  if (!q.data?.order) return <Screen><Notice tone="danger" text={t('err.FORBIDDEN')} /></Screen>;
  const { order, items, assignment, me } = q.data;
  const status = order.status as OrderStatus;
  const addr = order.delivery_address as Record<string, string | number | null>;
  const store = order.stores as { name: string; phone: string | null; latitude: number | null; longitude: number | null; avenue: string | null; commune: string | null } | null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['mission', id] });

  const run = async (fn: () => PromiseLike<{ data: unknown; error: any }>, success?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const data = unwrap(await fn()) as { ok?: boolean; attempts_left?: number } | null;
      if (data && data.ok === false && data.attempts_left !== undefined) {
        setMsg({ tone: 'danger', text: t('driver.otpWrong', { n: data.attempts_left }) });
      } else if (success) setMsg({ tone: 'success', text: success });
      refresh();
      qc.invalidateQueries({ queryKey: ['driver-active'] });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const advance = (to: OrderStatus) => run(() => supabase.rpc('advance_order_status', { p_order_id: id, p_status: to, p_note: null }));

  const openScanner = async () => {
    if (!permission?.granted && !(await requestPermission()).granted) return;
    scanned.current = false;
    setScanning(true);
  };
  const onScan = (r: BarcodeScanningResult) => {
    if (scanned.current) return;
    scanned.current = true;
    setScanning(false);
    setPackageCode(r.data);
    run(() => supabase.rpc('confirm_pickup', { p_order_id: id, p_package_code: r.data }));
  };

  const reportIncident = async () => {
    if (!incident) return;
    const { error } = await supabase.from('delivery_incidents').insert({
      order_id: id, assignment_id: assignment?.id ?? null, reported_by: session!.user.id, type: incident, description: incidentText.trim() || null,
    });
    if (error) Alert.alert(t('driver.incident'), errorMessage(error, t));
    else { setIncident(null); setIncidentText(''); setMsg({ tone: 'success', text: t('driver.incidentSent') }); }
  };

  const done = ['delivered', 'completed'].includes(status);

  return (
    <Screen>
      <Card>
        <T size="lg" weight="700">{order.order_number}</T>
        <T color={colors.primary} weight="600">{t(`status.${status}`)}</T>
        <T size="sm">{t('driver.fee', { amount: money(order.delivery_fee_usd) })}</T>
      </Card>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      {!done && assignment?.status === 'accepted' ? (() => {
        const route = decodePolyline(assignment.route_polyline);
        const toStore = ['driver_assigned', 'driver_to_store'].includes(status);
        const storePt = store?.latitude != null ? { latitude: store.latitude, longitude: store.longitude! } : null;
        const homePt = addr.latitude != null ? { latitude: Number(addr.latitude), longitude: Number(addr.longitude) } : null;
        const mePt = me?.current_latitude != null ? { latitude: me.current_latitude, longitude: me.current_longitude! } : null;
        const next = toStore ? storePt : homePt;
        return (
          <View style={{ gap: 8 }}>
            <KinMap
              height={320}
              cooperative
              fitKey={`${status}-${route.length}-${homePt?.latitude ?? ''}`}
              route={route}
              markers={[
                ...(mePt ? [{ id: 'me', ...mePt, kind: 'driver' as const, label: t('driver.you') }] : []),
                ...(storePt ? [{ id: 'store', ...storePt, kind: 'store' as const, label: store!.name, active: toStore }] : []),
                ...(homePt ? [{ id: 'home', ...homePt, kind: 'home' as const, label: String(addr.recipient_name ?? t('driver.client')), active: !toStore }] : []),
              ]}
              showLabels
            />
            {addr.shared_at ? <Notice tone="success" text={t('track.clientShared', { time: formatDate(String(addr.shared_at), language) })} /> : null}
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <T size="xs" muted>{toStore ? t('driver.nextStore') : t('driver.nextClient')}</T>
                  <T size="lg" weight="800">
                    {assignment.eta_minutes ? t('orders.eta', { min: assignment.eta_minutes }) : t('driver.routePending')}
                  </T>
                  {assignment.route_distance_km ? <T size="sm" muted>{t('stores.km', { km: assignment.route_distance_km })}</T> : null}
                </View>
                <Ionicons name={toStore ? 'storefront' : 'home'} size={28} color={toStore ? colors.accent2 : colors.primary} />
              </Row>
              {assignment.eta_updated_at ? <T size="xs" muted>{t('orders.etaSource', { time: formatDate(assignment.eta_updated_at, language) })}</T> : null}
              {next ? (
                <>
                  <Button title={t('nav.start')} icon="navigate" onPress={() => router.push(`/driver/navigate/${id}`)} />
                  <Button title={t('nav.googleMaps')} icon="logo-google" variant="ghost" onPress={() => startNavigation(next.latitude, next.longitude)} />
                </>
              ) : null}
            </Card>
          </View>
        );
      })() : null}
      {done ? <Notice tone="success" text={t('driver.delivered')} /> : null}

      <Card>
        <SectionHeader title={t('driver.pickup')} />
        <T weight="600">{store?.name}</T>
        <T size="sm" muted>{[store?.avenue, store?.commune].filter(Boolean).join(', ')}</T>
        <Row>
          {store?.latitude != null ? <Button title={t('stores.openMaps')} variant="ghost" icon="navigate-outline" onPress={() => Linking.openURL(mapsUrl(store.latitude!, store.longitude!))} /> : null}
          {store?.phone ? <Button title={t('common.call')} variant="ghost" icon="call-outline" onPress={() => Linking.openURL(`tel:${store.phone}`)} /> : null}
        </Row>
        <Divider />
        {items.map((i) => <T key={i.id} size="sm">• {i.product_name} × {formatQty(Number(i.quantity), i.unit, t)}</T>)}
      </Card>

      {status === 'driver_assigned' ? <Button title={t('driver.goToStore')} icon="bicycle-outline" loading={busy} onPress={() => advance('driver_to_store')} /> : null}
      {['driver_assigned', 'driver_to_store'].includes(status) ? (
        <Card>
          <Button title={t('driver.scanPackage')} icon="barcode-outline" onPress={openScanner} />
          <Input label={t('driver.packageCode')} value={packageCode} onChangeText={setPackageCode} autoCapitalize="characters" />
          <Button title={t('driver.confirmPickup')} variant="secondary" loading={busy} disabled={!packageCode.trim()}
            onPress={() => run(() => supabase.rpc('confirm_pickup', { p_order_id: id, p_package_code: packageCode.trim() }))} />
        </Card>
      ) : null}

      {['picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'].includes(status) ? (
        <Card>
          <SectionHeader title={t('driver.dropoff')} />
          <T weight="600">{String(addr.recipient_name ?? '')}</T>
          <T size="sm">{[addr.avenue, addr.street_number, addr.quartier, addr.commune].filter(Boolean).join(', ')}</T>
          {addr.landmark ? <T size="sm" muted>{String(addr.landmark)}</T> : null}
          {order.delivery_instructions ? <Notice text={order.delivery_instructions} /> : null}
          <Row>
            {addr.latitude != null ? <Button title={t('stores.openMaps')} variant="ghost" icon="navigate-outline" onPress={() => Linking.openURL(mapsUrl(Number(addr.latitude), Number(addr.longitude)))} /> : null}
            {addr.recipient_phone ? <Button title={t('common.call')} variant="ghost" icon="call-outline" onPress={() => Linking.openURL(`tel:${addr.recipient_phone}`)} /> : null}
          </Row>
        </Card>
      ) : null}

      {status === 'picked_up' ? <Button title={t('driver.startDelivery')} loading={busy} onPress={() => advance('in_delivery')} /> : null}
      {status === 'in_delivery' ? (
        <Row>
          <Button style={{ flex: 1 }} title={t('driver.near')} variant="secondary" loading={busy} onPress={() => advance('driver_near')} />
          <Button style={{ flex: 1 }} title={t('driver.arrived')} loading={busy} onPress={() => advance('driver_arrived')} />
        </Row>
      ) : null}
      {status === 'driver_near' ? <Button title={t('driver.arrived')} loading={busy} onPress={() => advance('driver_arrived')} /> : null}
      {status === 'driver_arrived' ? <Button title={t('driver.checkRecipient')} variant="secondary" loading={busy} onPress={() => advance('recipient_check')} /> : null}
      {['driver_arrived', 'recipient_check'].includes(status) ? (
        <Card>
          <Input label={t('driver.otp')} value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} />
          <Button title={t('driver.validateOtp')} icon="checkmark-done-outline" loading={busy} disabled={otp.length !== 6}
            onPress={() => run(() => supabase.rpc('verify_delivery_otp', { p_order_id: id, p_code: otp }), t('driver.delivered'))} />
        </Card>
      ) : null}

      {!done ? (
        <Card>
          <SectionHeader title={t('driver.incident')} />
          <Row style={{ flexWrap: 'wrap' }}>
            {INCIDENTS.map((k) => <Chip key={k} label={t(`driver.incident.${k}`)} active={incident === k} onPress={() => setIncident(k)} />)}
          </Row>
          {incident ? (
            <>
              <Input value={incidentText} onChangeText={setIncidentText} placeholder={t('support.message')} multiline />
              <Button title={t('common.send')} variant="danger" onPress={reportIncident} />
            </>
          ) : null}
        </Card>
      ) : <Button title={t('role.driver')} variant="ghost" onPress={() => router.replace('/driver')} />}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" onBarcodeScanned={onScan}
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }} />
          <View style={{ position: 'absolute', bottom: 40, left: 16, right: 16 }}>
            <Button title={t('common.close')} variant="secondary" onPress={() => setScanning(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
