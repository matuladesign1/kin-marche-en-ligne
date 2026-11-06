import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { KinMap } from '@/components/KinMap';
import { Button, Chip, Input, Notice, Row, Screen, T } from '@/components/ui';
import { qk } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import type { LatLng } from '@/lib/geo';
import { currentPosition } from '@/lib/location';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function NewAddress() {
  const { t, colors } = useSettings();
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({
    label: 'Domicile', recipient_name: profile?.full_name ?? '', recipient_phone: profile?.phone ?? '',
    commune: '', quartier: '', avenue: '', street_number: '', landmark: '',
  });
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  // Choix de la position exacte : carte plein écran (un doigt pour déplacer), repère fixe au centre.
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [draftOk, setDraftOk] = useState(false);
  const [pickKey, setPickKey] = useState(0);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const locate = async (): Promise<LatLng | null> => {
    setLocating(true);
    setGpsError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGpsError(t('stores.locationDenied')); return null; }
      const pos = await currentPosition(Location.Accuracy.Highest, { timeoutMs: 20_000, maxAgeMs: 2 * 60_000 });
      if (!pos) { setGpsError(t('stores.locationUnavailable')); return null; }
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      setGpsError(t('stores.locationUnavailable'));
      return null;
    } finally {
      setLocating(false);
    }
  };

  const gps = async () => {
    const p = await locate();
    if (p) setCoords(p);
  };

  const openPicker = () => {
    setGpsError(null);
    setDraft(coords);
    setDraftOk(!!coords);
    setPickKey((k) => k + 1);
    setPicking(true);
  };
  const pickerGps = async () => {
    const p = await locate();
    if (p) {
      setDraft(p);
      setDraftOk(true);
      setPickKey((k) => k + 1);   // la carte se place sur la position trouvée
    }
  };
  const confirmPick = () => {
    if (draft) setCoords(draft);
    setPicking(false);
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
      <Button title={t('address.useGps')} icon="locate-outline" variant={coords ? 'secondary' : 'ghost'} loading={locating && !picking} onPress={gps} />
      {gpsError && !picking ? <Notice tone="warning" text={gpsError} /> : null}

      {/* Aperçu fixe : toucher ouvre la carte plein écran (pas de déplacement involontaire en faisant défiler la page). */}
      <Pressable onPress={openPicker} accessibilityRole="button" accessibilityLabel={coords ? t('address.editOnMap') : t('address.pickOnMap')}>
        <View pointerEvents="none">
          <KinMap
            key={coords ? `${coords.latitude},${coords.longitude}` : 'none'}
            height={170}
            interactive={false}
            initialCenter={coords ?? undefined}
            initialZoom={coords ? 17 : 11}
            markers={coords ? [{ id: 'home', latitude: coords.latitude, longitude: coords.longitude, kind: 'home' }] : []}
          />
        </View>
        <View style={[styles.pickBadge, { backgroundColor: colors.primary }]}>
          <Ionicons name="hand-left-outline" size={16} color="#FFFFFF" />
          <T size="sm" weight="700" color="#FFFFFF">{coords ? t('address.editOnMap') : t('address.pickOnMap')}</T>
        </View>
      </Pressable>
      <T size="xs" muted>{coords ? t('address.pinSet', { lat: coords.latitude.toFixed(5), lng: coords.longitude.toFixed(5) }) : t('address.pinHint')}</T>
      <Row><Chip label={t('address.default')} icon="checkmark" active={isDefault} onPress={() => setIsDefault((v) => !v)} /></Row>
      <Button title={t('common.save')} onPress={save} loading={saving} />

      <Modal visible={picking} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setPicking(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
          <Row style={styles.pickHeader}>
            <T size="lg" weight="800" style={{ flex: 1 }}>{t('address.pickTitle')}</T>
            <Pressable onPress={() => setPicking(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </Row>
          <View style={{ flex: 1 }}>
            <KinMap
              key={pickKey}
              centerPin
              rounded={false}
              style={{ borderWidth: 0 }}
              initialCenter={draft ?? undefined}
              initialZoom={draft ? 18 : 12}
              onUserMove={() => setDraftOk(true)}
              onCenterChange={setDraft}
            />
          </View>
          <View style={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 10 }}>
            <T size="sm" muted>{t('address.pickHelp')}</T>
            {gpsError ? <Notice tone="warning" text={gpsError} /> : null}
            <Button title={t('address.myGps')} icon="locate-outline" variant="secondary" loading={locating} onPress={pickerGps} />
            <Button title={t('address.pickConfirm')} icon="checkmark" disabled={!draftOk} onPress={confirmPick} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pickBadge: {
    position: 'absolute', alignSelf: 'center', bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, elevation: 3,
  },
  pickHeader: { paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'space-between' },
});
