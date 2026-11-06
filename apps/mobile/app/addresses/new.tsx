import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KinMap } from '@/components/KinMap';
import { Button, Chip, Input, Notice, Row, Screen, T } from '@/components/ui';
import { qk } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { currentPosition } from '@/lib/location';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function NewAddress() {
  const { t } = useSettings();
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({
    label: 'Domicile', recipient_name: profile?.full_name ?? '', recipient_phone: profile?.phone ?? '',
    commune: '', quartier: '', avenue: '', street_number: '', landmark: '',
  });
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  // Position exacte : le client déplace la carte pour mettre le repère sur sa porte.
  const [mapKey, setMapKey] = useState(0);
  const [pinMoved, setPinMoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const gps = async () => {
    setLocating(true);
    setGpsError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setGpsError(t('stores.locationDenied'));
      const pos = await currentPosition(Location.Accuracy.Highest, { timeoutMs: 20_000, maxAgeMs: 2 * 60_000 });
      if (!pos) return setGpsError(t('stores.locationUnavailable'));
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setMapKey((k) => k + 1);   // la carte se place sur la position trouvée
    } catch {
      setGpsError(t('stores.locationUnavailable'));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    setError(null);
    if (!f.commune.trim() || !f.label.trim()) return setError(`${t('address.commune')} : ${t('common.required')}`);
    setSaving(true);
    if (isDefault) await supabase.from('addresses').update({ is_default: false }).eq('user_id', session!.user.id);
    const { error: e } = await supabase.from('addresses').insert({
      user_id: session!.user.id,
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])),
      label: f.label.trim(),
      commune: f.commune.trim(),
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      is_default: isDefault,
    });
    setSaving(false);
    if (e) return setError(errorMessage(e, t));
    qc.invalidateQueries({ queryKey: qk.addresses });
    router.back();
  };

  return (
    <Screen>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Input label={t('address.label')} value={f.label} onChangeText={set('label')} />
      <Input label={t('address.recipient')} value={f.recipient_name} onChangeText={set('recipient_name')} />
      <Input label={t('address.recipientPhone')} value={f.recipient_phone} onChangeText={set('recipient_phone')} keyboardType="phone-pad" />
      <Input label={`${t('address.commune')} *`} value={f.commune} onChangeText={set('commune')} placeholder="Limete" />
      <Input label={t('address.quartier')} value={f.quartier} onChangeText={set('quartier')} />
      <Input label={t('address.avenue')} value={f.avenue} onChangeText={set('avenue')} placeholder="7e rue" />
      <Input label={t('address.number')} value={f.street_number} onChangeText={set('street_number')} />
      <Input label={t('address.landmark')} value={f.landmark} onChangeText={set('landmark')} />
      <Button title={coords ? t('address.gpsSaved') : t('address.useGps')} icon="locate-outline" variant={coords ? 'secondary' : 'ghost'} loading={locating} onPress={gps} />
      {gpsError ? <Notice tone="warning" text={gpsError} /> : null}
      <KinMap
        key={mapKey}
        height={260}
        centerPin
        controls
        initialCenter={coords ?? undefined}
        initialZoom={coords ? 18 : 12}
        onUserMove={() => setPinMoved(true)}
        onCenterChange={(c) => { if (pinMoved || coords) setCoords(c); }}
      />
      <T size="xs" muted>{coords ? t('address.pinSet', { lat: coords.latitude.toFixed(5), lng: coords.longitude.toFixed(5) }) : t('address.pinHint')}</T>
      <Row><Chip label={t('address.default')} icon="checkmark" active={isDefault} onPress={() => setIsDefault((v) => !v)} /></Row>
      <Button title={t('common.save')} onPress={save} loading={saving} />
    </Screen>
  );
}
