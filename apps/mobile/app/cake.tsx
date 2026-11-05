import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Chip, EmptyState, Input, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { useAddresses, useStores } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const MIN_DAYS = 2;

export default function Cake() {
  const { t } = useSettings();
  const { session, profile } = useAuth();
  const stores = useStores();
  const addresses = useAddresses();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [f, setF] = useState({
    full_name: profile?.full_name ?? '', phone: profile?.phone ?? '', email: profile?.email ?? '',
    cake_type: '', size: '', servings: '', flavor: '', color: '', inscription: '', desired_date: '', desired_time: '',
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  if (!session) return <EmptyState message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) setPhoto(res.assets[0]);
  };

  const submit = async () => {
    setError(null);
    if (!storeId || !f.full_name.trim() || !f.phone.trim() || !f.cake_type.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(f.desired_date)) {
      return setError(t('common.required'));
    }
    const min = new Date();
    min.setDate(min.getDate() + MIN_DAYS);
    if (new Date(f.desired_date) < new Date(min.toISOString().slice(0, 10))) return setError(t('cake.minDelay', { days: MIN_DAYS }));
    setSending(true);
    try {
      let path: string | null = null;
      if (photo) {
        path = `${session.user.id}/${Date.now()}.jpg`;
        const blob = await (await fetch(photo.uri)).arrayBuffer();
        const up = await supabase.storage.from('cake-references').upload(path, blob, { contentType: photo.mimeType ?? 'image/jpeg' });
        if (up.error) throw up.error;
      }
      const addr = addresses.data?.find((a) => a.id === addressId) ?? null;
      const { error: e } = await supabase.from('cake_orders').insert({
        customer_id: session.user.id,
        store_id: storeId,
        full_name: f.full_name.trim(),
        phone: f.phone.trim(),
        email: f.email.trim() || null,
        cake_type: f.cake_type.trim(),
        size: f.size.trim() || null,
        servings: f.servings ? Number(f.servings) : null,
        flavor: f.flavor.trim() || null,
        color: f.color.trim() || null,
        inscription: f.inscription.trim() || null,
        reference_photo_path: path,
        desired_date: f.desired_date,
        desired_time: /^\d{2}:\d{2}$/.test(f.desired_time) ? f.desired_time : null,
        delivery_address: addr,
      });
      if (e) throw e;
      setDone(true);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  if (done) return <Screen><Notice tone="success" text={t('cake.sent')} /><Button title={t('tab.home')} onPress={() => router.replace('/(customer)')} /></Screen>;

  return (
    <Screen>
      <Notice text={t('cake.intro')} />
      <T size="sm" muted>{t('cake.minDelay', { days: MIN_DAYS })}</T>
      {error ? <Notice tone="danger" text={error} /> : null}
      <SectionHeader title={t('cake.store')} />
      <Row style={{ flexWrap: 'wrap' }}>
        {(stores.data ?? []).map((s) => <Chip key={s.id} label={s.name} active={storeId === s.id} onPress={() => setStoreId(s.id)} />)}
      </Row>
      <Input label={`${t('auth.fullName')} *`} value={f.full_name} onChangeText={set('full_name')} />
      <Input label={`${t('auth.phone')} *`} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
      <Input label={t('auth.email')} value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
      <Input label={`${t('cake.type')} *`} value={f.cake_type} onChangeText={set('cake_type')} />
      <Input label={t('cake.size')} value={f.size} onChangeText={set('size')} />
      <Input label={t('cake.servings')} value={f.servings} onChangeText={set('servings')} keyboardType="number-pad" />
      <Input label={t('cake.flavor')} value={f.flavor} onChangeText={set('flavor')} />
      <Input label={t('cake.color')} value={f.color} onChangeText={set('color')} />
      <Input label={t('cake.text')} value={f.inscription} onChangeText={set('inscription')} maxLength={80} />
      <Input label={`${t('cake.date')} *`} value={f.desired_date} onChangeText={set('desired_date')} placeholder="2026-12-24" />
      <Input label={t('cake.time')} value={f.desired_time} onChangeText={set('desired_time')} placeholder="15:00" />
      <SectionHeader title={t('cake.address')} />
      <Row style={{ flexWrap: 'wrap' }}>
        {(addresses.data ?? []).map((a) => <Chip key={a.id} label={`${a.label} — ${a.commune}`} active={addressId === a.id} onPress={() => setAddressId(a.id)} />)}
      </Row>
      <Button title={photo ? '✓ ' + t('cake.photo') : t('cake.photo')} variant="ghost" icon="image-outline" onPress={pick} />
      <Button title={t('cake.submit')} loading={sending} onPress={submit} />
    </Screen>
  );
}
