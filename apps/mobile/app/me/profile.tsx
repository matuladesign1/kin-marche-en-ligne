import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, FlagCD, ListGroup, ListRow } from '@/components/kit';
import { Button, Input, Notice, Row, T } from '@/components/ui';
import { qk, useLoyalty, useStores } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { maskPhone } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import { isTier, normalizePhone } from '@/lib/loyalty';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { pickImage, randomName, uploadFile } from '@/lib/upload';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const TIER_STYLE = {
  silver: { bg: '#E6E8EC', fg: '#4A4F57' },
  gold: { bg: '#F7E7B4', fg: '#7A5A00' },
  platinum: { bg: '#2B2F36', fg: '#F2F3F5' },
} as const;

function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 3)}${'*'.repeat(Math.max(user.length - 4, 2))}${user.slice(-1)}@${domain}`;
}

/** Modification d'un champ (nom, téléphone) dans une fenêtre. */
function EditField({ visible, title, initial, hint, keyboardType, onClose, onSave }: {
  visible: boolean; title: string; initial: string; hint?: string; keyboardType?: 'default' | 'phone-pad';
  onClose: () => void; onSave: (value: string) => Promise<string | null>;
}) {
  const { t, colors } = useSettings();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => { setValue(initial); setError(null); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
        <View style={[styles.modal, { backgroundColor: colors.surface }]}>
          <T size="lg" weight="800">{title}</T>
          <Input value={value} onChangeText={setValue} autoFocus keyboardType={keyboardType} maxLength={120} error={error} />
          {hint ? <T size="xs" muted>{hint}</T> : null}
          <Row style={{ justifyContent: 'flex-end' }}>
            <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
            <Button title={t('common.save')} loading={busy} onPress={async () => {
              setBusy(true);
              const err = await onSave(value);
              setBusy(false);
              if (err) setError(err); else onClose();
            }} />
          </Row>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function Profile() {
  const { t, colors, currency, language, selectedStoreId } = useSettings();
  const { session, profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const loyalty = useLoyalty();
  const stores = useStores();
  const [editing, setEditing] = useState<'name' | 'phone' | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  if (!session || !profile) return <Redirect href="/(auth)/sign-in" />;
  const uid = session.user.id;

  const uploadPhoto = async (source: 'camera' | 'gallery') => {
    setMsg(null);
    const img = await pickImage(source, { front: true, square: true });
    if (img === 'denied') return setMsg({ tone: 'danger', text: t('search.cameraDenied') });
    if (!img) return;
    setBusyPhoto(true);
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
      setBusyPhoto(false);
    }
  };

  const changePhoto = () => Alert.alert(t('account.photo'), t('account.photoHelp'), [
    { text: t('common.camera'), onPress: () => uploadPhoto('camera') },
    { text: t('common.gallery'), onPress: () => uploadPhoto('gallery') },
    { text: t('common.cancel'), style: 'cancel' },
  ]);

  const saveName = async (value: string): Promise<string | null> => {
    if (!value.trim()) return t('common.required');
    try {
      unwrap(await supabase.from('profiles').update({ full_name: value.trim() }).eq('id', uid));
      await refreshProfile();
      setMsg({ tone: 'success', text: t('account.profileSaved') });
      return null;
    } catch (e) {
      return errorMessage(e, t);
    }
  };

  const savePhone = async (value: string): Promise<string | null> => {
    // Le téléphone devient le numéro de la carte Kin Marché Fidélité : format international obligatoire.
    const normalized = value.trim() ? normalizePhone(value) : null;
    if (value.trim() && !normalized) return t('auth.phoneInvalid');
    try {
      unwrap(await supabase.from('profiles').update({ phone: normalized }).eq('id', uid));
      await refreshProfile();
      // Le serveur relie la carte ou l'émet (client déjà qualifié) dès que le téléphone change.
      qc.invalidateQueries({ queryKey: qk.loyalty });
      setMsg({ tone: 'success', text: t('account.profileSaved') });
      return null;
    } catch (e) {
      return errorMessage(e, t);
    }
  };

  const card = loyalty.data?.card;
  const tier = card && card.card_status !== 'none' && isTier(card.tier) ? card.tier : null;
  const providers = new Set<string>([
    ...((session.user.identities ?? []).map((i) => i.provider)),
    ...(((session.user.app_metadata?.providers as string[] | undefined) ?? [])),
  ]);
  const storeName = stores.data?.find((s) => s.id === selectedStoreId)?.name ?? t('home.allStores');
  const languageLabel = LANGUAGES.find((l) => l.code === language)?.label ?? language;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: spacing.xxl * 2, gap: spacing.lg }}>
      <View style={[styles.head, { backgroundColor: colors.surface }]}>
        <Pressable onPress={changePhoto} disabled={busyPhoto} accessibilityRole="button" accessibilityLabel={t('account.photo')}>
          <Avatar uri={profile.avatar_url} name={profile.full_name ?? profile.email} size={84} />
          <View style={[styles.editBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name={busyPhoto ? 'hourglass-outline' : 'create-outline'} size={16} color={colors.text} />
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 6 }}>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <T size="xl" weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{(profile.full_name || profile.email || '').split(' ')[0]}</T>
            <Pressable onPress={() => router.push('/loyalty')} accessibilityRole="button"
              style={[styles.tier, { backgroundColor: tier ? TIER_STYLE[tier].bg : colors.surfaceAlt }]}>
              <Ionicons name="ribbon" size={12} color={tier ? TIER_STYLE[tier].fg : colors.textMuted} />
              <T size="xs" weight="800" color={tier ? TIER_STYLE[tier].fg : colors.textMuted}>{tier ? t(`loyalty.tier.${tier}`) : t('profile.customer')}</T>
            </Pressable>
          </Row>
          <Pressable onPress={() => Alert.alert(t('profile.countryTitle'), t('profile.countryText'))} style={styles.country} accessibilityRole="button">
            <FlagCD width={22} />
            <T weight="600">CD</T>
            <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        <Pressable onPress={() => router.push('/loyalty')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('loyalty.title')}>
          <Ionicons name="qr-code-outline" size={30} color={colors.text} />
        </Pressable>
      </View>

      {msg ? <View style={{ paddingHorizontal: spacing.md }}><Notice tone={msg.tone} text={msg.text} /></View> : null}

      <ListGroup>
        <ListRow label={t('auth.fullName')} value={profile.full_name ?? '—'} onPress={() => setEditing('name')} />
        <ListRow label={t('auth.email')} value={maskEmail(profile.email)} onPress={() => router.push('/me/email')} />
        <ListRow label={t('auth.phone')} value={profile.phone ? maskPhone(profile.phone) : t('profile.addPhone')} onPress={() => setEditing('phone')} />
        <ListRow label={t('account.changePassword')} onPress={() => router.push('/me/password')} />
      </ListGroup>

      <ListGroup title={t('profile.connected')} footer={t('profile.connectedHint')}>
        <ListRow label="Google" icon="logo-google" iconColor="#4285F4" right={<T muted>{providers.has('google') ? t('profile.linked') : t('profile.notLinked')}</T>} />
        <ListRow label="Facebook" icon="logo-facebook" iconColor="#1877F2" right={<T muted>{providers.has('facebook') ? t('profile.linked') : t('profile.notLinked')}</T>} />
        <ListRow label={t('loyalty.title')} icon="card" iconColor="#E8A317"
          value={card?.card_number && card.card_status !== 'none' ? t('profile.cardLinked') : t('profile.cardLink')}
          onPress={() => router.push('/loyalty')} />
      </ListGroup>

      <ListGroup title={t('profile.preferences')}>
        <View style={styles.prefs}>
          <Pressable onPress={() => router.push('/stores')} style={[styles.pref, { borderColor: colors.text }]} accessibilityRole="button">
            <Ionicons name="storefront-outline" size={16} color={colors.text} />
            <T weight="600" numberOfLines={1}>{storeName}</T>
          </Pressable>
          <Pressable onPress={() => router.push('/settings')} style={[styles.pref, { borderColor: colors.text }]} accessibilityRole="button">
            <Ionicons name="cash-outline" size={16} color={colors.text} />
            <T weight="600">{currency}</T>
          </Pressable>
          <Pressable onPress={() => router.push('/settings')} style={[styles.pref, { borderColor: colors.text }]} accessibilityRole="button">
            <Ionicons name="language-outline" size={16} color={colors.text} />
            <T weight="600">{languageLabel}</T>
          </Pressable>
        </View>
      </ListGroup>

      <ListGroup>
        <ListRow label={t('account.addresses')} icon="location-outline" onPress={() => router.push('/addresses')} />
        <ListRow label={t('account.notifications')} icon="notifications-outline" onPress={() => router.push('/me/notifications')} />
      </ListGroup>

      <EditField visible={editing === 'name'} title={t('auth.fullName')} initial={profile.full_name ?? ''}
        onClose={() => setEditing(null)} onSave={saveName} />
      <EditField visible={editing === 'phone'} title={t('auth.phone')} initial={profile.phone ?? ''} hint={t('auth.phoneHint')}
        keyboardType="phone-pad" onClose={() => setEditing(null)} onSave={savePhone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg },
  editBadge: { position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tier: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  country: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  prefs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg },
  pref: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.lg, minHeight: 44, maxWidth: '100%' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.xl },
  modal: { borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
});
