import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Chip, EmptyState, Input, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const TRANSPORTS = ['foot', 'bicycle', 'motorbike', 'car', 'van', 'truck'] as const;
type Transport = (typeof TRANSPORTS)[number];
const DOCS = ['profile', 'id_photo', 'vehicle_registration'] as const;
type Doc = (typeof DOCS)[number];

export default function DriverSignup() {
  const { t } = useSettings();
  const { session, refreshProfile } = useAuth();
  const existing = useQuery({
    queryKey: ['my-driver'],
    enabled: !!session,
    queryFn: async () => (await supabase.from('drivers').select('status').eq('id', session!.user.id).maybeSingle()).data as { status: string } | null,
  });
  const [f, setF] = useState({ address: '', zones: '', plate: '', maxWeight: '', emergencyName: '', emergencyPhone: '', payoutAccount: '' });
  const [transport, setTransport] = useState<Transport>('motorbike');
  const [payout, setPayout] = useState<'mobile_money' | 'bank'>('mobile_money');
  const [docs, setDocs] = useState<Partial<Record<Doc, ImagePicker.ImagePickerAsset>>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  if (!session) return <EmptyState message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;
  if (existing.data && !done) {
    return <Screen><Notice tone={existing.data.status === 'verified' ? 'success' : 'info'} text={t(`driver.status.${existing.data.status as 'verified'}`)} /></Screen>;
  }
  if (done) return <Screen><Notice tone="success" text={t('driver.submitted')} /><Button title={t('tab.home')} onPress={() => router.replace('/')} /></Screen>;

  const pick = (doc: Doc) => async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) setDocs((d) => ({ ...d, [doc]: res.assets[0] }));
  };

  const submit = async () => {
    setError(null);
    if (!f.address.trim() || !f.zones.trim() || !f.emergencyName.trim() || !f.emergencyPhone.trim() || !f.payoutAccount.trim()) return setError(t('common.required'));
    if (!docs.profile || !docs.id_photo) return setError(`${t('driver.doc.profile')} + ${t('driver.doc.id_photo')} : ${t('common.required')}`);
    if (['motorbike', 'car', 'van', 'truck'].includes(transport) && (!f.plate.trim() || !docs.vehicle_registration)) {
      return setError(`${t('driver.plate')} + ${t('driver.doc.vehicle_registration')} : ${t('common.required')}`);
    }
    setSending(true);
    try {
      unwrap(await supabase.rpc('register_driver', {
        p_address: f.address.trim(),
        p_zone_communes: f.zones.split(',').map((z) => z.trim()).filter(Boolean),
        p_transport: transport,
        p_plate: f.plate.trim() || null,
        p_max_weight_kg: f.maxWeight ? Number(f.maxWeight.replace(',', '.')) : null,
        p_emergency_name: f.emergencyName.trim(),
        p_emergency_phone: f.emergencyPhone.trim(),
        p_payout_method: payout,
        p_payout_account: f.payoutAccount.replace(/\s/g, ''),
      }));
      const uid = session.user.id;
      for (const [doc, asset] of Object.entries(docs) as [Doc, ImagePicker.ImagePickerAsset][]) {
        const bucket = doc === 'profile' ? 'avatars' : 'driver-documents';
        const path = `${uid}/${doc}-${Date.now()}.jpg`;
        const body = await (await fetch(asset.uri)).arrayBuffer();
        const up = await supabase.storage.from(bucket).upload(path, body, { contentType: asset.mimeType ?? 'image/jpeg' });
        if (up.error) throw up.error;
        if (doc === 'profile') {
          const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
          await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid);
        } else {
          unwrap(await supabase.from('driver_documents').insert({ driver_id: uid, doc_type: doc, storage_path: path }));
        }
      }
      await refreshProfile();
      setDone(true);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <Notice text={t('driver.signupIntro')} />
      {error ? <Notice tone="danger" text={error} /> : null}
      <Input label={`${t('driver.address')} *`} value={f.address} onChangeText={set('address')} />
      <Input label={`${t('driver.zones')} *`} value={f.zones} onChangeText={set('zones')} placeholder="Limete, Matete, Lemba" />
      <SectionHeader title={t('driver.transport')} />
      <Row style={{ flexWrap: 'wrap' }}>
        {TRANSPORTS.map((m) => <Chip key={m} label={t(`transport.${m}`)} active={transport === m} onPress={() => setTransport(m)} />)}
      </Row>
      <Input label={t('driver.plate')} value={f.plate} onChangeText={set('plate')} autoCapitalize="characters" />
      <Input label={t('driver.maxWeight')} value={f.maxWeight} onChangeText={set('maxWeight')} keyboardType="decimal-pad" />
      <Input label={`${t('driver.emergencyName')} *`} value={f.emergencyName} onChangeText={set('emergencyName')} />
      <Input label={`${t('driver.emergencyPhone')} *`} value={f.emergencyPhone} onChangeText={set('emergencyPhone')} keyboardType="phone-pad" />
      <SectionHeader title={t('driver.payout')} />
      <Row>
        <Chip label="Mobile Money" active={payout === 'mobile_money'} onPress={() => setPayout('mobile_money')} />
        <Chip label={t('payment.bank_transfer')} active={payout === 'bank'} onPress={() => setPayout('bank')} />
      </Row>
      <Input label={`${t('driver.payoutAccount')} *`} value={f.payoutAccount} onChangeText={set('payoutAccount')} />
      <SectionHeader title={t('driver.docs')} />
      {DOCS.map((d) => (
        <Button key={d} variant={docs[d] ? 'secondary' : 'ghost'} icon={docs[d] ? 'checkmark-circle' : 'document-attach-outline'}
          title={t(`driver.doc.${d}`)} onPress={pick(d)} />
      ))}
      <T size="xs" muted>{t('checkout.noCash')}</T>
      <Button title={t('driver.submit')} loading={sending} onPress={submit} />
    </Screen>
  );
}
