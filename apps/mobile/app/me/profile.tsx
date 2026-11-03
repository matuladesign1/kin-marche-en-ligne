import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Notice, Row, Screen, T } from '@/components/ui';
import { qk } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { normalizePhone } from '@/lib/loyalty';
import { supabase, unwrap } from '@/lib/supabase';
import { pickImage, randomName, uploadFile } from '@/lib/upload';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function Profile() {
  const { t, colors } = useSettings();
  const { session, profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  if (!session || !profile) return <Redirect href="/(auth)/sign-in" />;
  const uid = session.user.id;

  const changePhoto = async (source: 'camera' | 'gallery') => {
    setMsg(null);
    const img = await pickImage(source, { front: true, square: true });
    if (img === 'denied') return setMsg({ tone: 'danger', text: t('search.cameraDenied') });
    if (!img) return;
    setBusy('photo');
    try {
      const path = await uploadFile('avatars', `${uid}/${randomName(img.ext)}`, img);
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      unwrap(await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid));
      // Supprime les anciennes photos du dossier personnel.
      const old = await supabase.storage.from('avatars').list(uid);
      const stale = (old.data ?? []).map((f) => `${uid}/${f.name}`).filter((p) => p !== path);
      if (stale.length) await supabase.storage.from('avatars').remove(stale);
      await refreshProfile();
      setMsg({ tone: 'success', text: t('account.photoSaved') });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setMsg(null);
    if (!name.trim()) return setMsg({ tone: 'danger', text: t('common.required') });
    // Le téléphone devient le numéro de la carte Kin Marché Fidélité : format international obligatoire.
    const normalized = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !normalized) return setMsg({ tone: 'danger', text: t('auth.phoneInvalid') });
    setBusy('save');
    try {
      unwrap(await supabase.from('profiles').update({ full_name: name.trim(), phone: normalized }).eq('id', uid));
      if (normalized) setPhone(normalized);
      await refreshProfile();
      // Le serveur relie la carte ou l'émet (client déjà qualifié) dès que le téléphone change.
      qc.invalidateQueries({ queryKey: qk.loyalty });
      setMsg({ tone: 'success', text: t('account.profileSaved') });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={{ width: 128, height: 128, borderRadius: 64 }} accessibilityLabel={t('account.photo')} />
        ) : (
          <View style={{ width: 128, height: 128, borderRadius: 64, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person-outline" size={56} color={colors.textMuted} />
          </View>
        )}
        <T weight="700">{t('account.photo')}</T>
        <T size="sm" muted style={{ textAlign: 'center' }}>{t('account.photoHelp')}</T>
        <Row>
          <Button title={t('common.camera')} icon="camera-outline" variant="secondary" loading={busy === 'photo'} onPress={() => changePhoto('camera')} />
          <Button title={t('common.gallery')} icon="images-outline" variant="secondary" disabled={busy === 'photo'} onPress={() => changePhoto('gallery')} />
        </Row>
      </Card>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      <Input label={t('auth.fullName')} value={name} onChangeText={setName} maxLength={120} autoComplete="name" />
      <Input label={t('auth.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} autoComplete="tel" />
      <T size="xs" muted style={{ marginTop: -6 }}>{t('auth.phoneHint')}</T>
      <Input label={t('auth.email')} value={profile.email ?? ''} editable={false} />
      <Button title={t('common.save')} icon="checkmark-outline" loading={busy === 'save'} onPress={save} />
    </Screen>
  );
}
