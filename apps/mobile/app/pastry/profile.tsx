import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { Avatar } from '@/components/kit';
import { PrivatePhoto } from '@/components/Pastry';
import { Button, Chip, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { useMyPastryChef } from '@/hooks/pastry';
import { errorMessage } from '@/lib/errors';
import { PASTRY, formatBirthDate, listOf, parseBirthDate, profileChecklist } from '@/lib/pastry';
import { homeForRole } from '@/lib/roles';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import type { PastryChef } from '@/lib/types';
import { pickImage, randomName, uploadFile, type PickedImage } from '@/lib/upload';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Profil complet du pâtissier : présentation (visible des clients), identité, pièce d'identité (visible
// seulement par Kin Marché et son supermarché), adresse et contact d'urgence. Un profil complet est
// vérifié puis certifié par l'administrateur général.

const GENDERS: NonNullable<PastryChef['gender']>[] = ['female', 'male', 'other'];
const ID_TYPES: NonNullable<PastryChef['id_type']>[] = ['voter_card', 'passport', 'driver_license', 'other'];

function Section({ icon, title, children, hint }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: ReactNode; hint?: string }) {
  const { colors } = useSettings();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Row gap={spacing.sm}>
        <View style={[styles.sectionIcon, { backgroundColor: `${PASTRY.raspberry}1A` }]}><Ionicons name={icon} size={17} color={PASTRY.raspberry} /></View>
        <T size="lg" weight="800" style={{ flex: 1 }}>{title}</T>
      </Row>
      {hint ? <T size="xs" muted style={{ marginTop: -4 }}>{hint}</T> : null}
      {children}
    </View>
  );
}

export default function PastryProfile() {
  const { t, colors } = useSettings();
  const { profile, session, loading } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const chef = useMyPastryChef();
  const c = chef.data;

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState<PastryChef['gender']>(null);
  const [nationality, setNationality] = useState('');
  const [idType, setIdType] = useState<PastryChef['id_type']>(null);
  const [idNumber, setIdNumber] = useState('');
  const [idPhoto, setIdPhoto] = useState<PickedImage | null>(null);
  const [address, setAddress] = useState('');
  const [commune, setCommune] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!c || loaded) return;
    setDisplayName(c.display_name ?? profile?.full_name ?? '');
    setBio(c.bio ?? '');
    setYears(c.years_experience != null ? String(c.years_experience) : '');
    setSpecialties(c.specialties ?? []);
    setBirth(formatBirthDate(c.birth_date));
    setGender(c.gender);
    setNationality(c.nationality ?? 'Congolaise');
    setIdType(c.id_type);
    setIdNumber(c.id_number ?? '');
    setAddress(c.address ?? '');
    setCommune(c.commune ?? '');
    setEmergencyName(c.emergency_name ?? '');
    setEmergencyPhone(c.emergency_phone ?? '');
    setLoaded(true);
  }, [c, loaded, profile?.full_name]);

  if (loading || chef.isLoading) return <Loading />;
  if (profile?.role !== 'pastry_chef' || !c) return <Redirect href={homeForRole(profile?.role)} />;

  const birthIso = birth.trim() ? parseBirthDate(birth) : null;
  const check = profileChecklist({
    display_name: displayName, birth_date: birthIso, id_type: idType, id_number: idNumber,
    id_photo_path: idPhoto ? 'new' : c.id_photo_path, address, commune, specialties,
  }, profile?.phone);
  const pct = Math.round((check.done / check.total) * 100);

  const toggle = (s: string) => setSpecialties((list) => list.includes(s) ? list.filter((x) => x !== s) : [...list, s].slice(0, 12));
  const addCustom = () => {
    const s = custom.trim();
    if (!s) return;
    if (!specialties.includes(s)) setSpecialties((list) => [...list, s].slice(0, 12));
    setCustom('');
  };
  const takeId = async (source: 'camera' | 'gallery') => {
    const img = await pickImage(source);
    if (img === 'denied') return setMsg({ tone: 'danger', text: t('search.cameraDenied') });
    if (img) setIdPhoto(img);
  };

  const save = async () => {
    setMsg(null);
    if (birth.trim() && !birthIso) return setMsg({ tone: 'danger', text: t('err.INVALID_BIRTH_DATE') });
    setSaving(true);
    try {
      const photoPath = idPhoto ? await uploadFile('pastry-documents', `${uid}/${randomName(idPhoto.ext)}`, idPhoto) : c.id_photo_path;
      const res = unwrap(await supabase.rpc('save_pastry_profile', {
        p_display_name: displayName.trim() || null,
        p_bio: bio.trim() || null,
        p_specialties: specialties,
        p_years: years ? Number(years) : null,
        p_birth_date: birthIso,
        p_gender: gender,
        p_nationality: nationality.trim() || null,
        p_id_type: idType,
        p_id_number: idNumber.trim() || null,
        p_id_photo_path: photoPath,
        p_address: address.trim() || null,
        p_commune: commune.trim() || null,
        p_emergency_name: emergencyName.trim() || null,
        p_emergency_phone: emergencyPhone.trim() || null,
      })) as { completed: boolean; certified: boolean };
      const idChanged = !!c.certified && !res.certified;
      setIdPhoto(null);
      qc.invalidateQueries({ queryKey: ['pastry', 'me'] });
      setMsg({
        tone: 'success',
        text: idChanged ? t('pastryProfile.idReset') : res.certified ? t('pastryProfile.saved') : res.completed ? t('pastryProfile.complete') : t('pastryProfile.saved'),
      });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('pastryProfile.title') }} />

      {/* Carte d'identité du pâtissier et progression */}
      <View style={[styles.card, { backgroundColor: PASTRY.choco }]}>
        <View style={[styles.blob, { backgroundColor: PASTRY.raspberry, top: -50, right: -40 }]} />
        <Row gap={spacing.md}>
          <View>
            <Avatar uri={profile.avatar_url} name={profile.full_name} size={64} />
            <View style={styles.hat}><MaterialCommunityIcons name="chef-hat" size={14} color="#FFFFFF" /></View>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Row gap={6}>
              <T size="lg" weight="800" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName || profile.full_name || '—'}</T>
              {c.certified ? <CertifiedBadge size={18} label={t('pastryProfile.certified')} /> : null}
            </Row>
            <T size="xs" color={PASTRY.cocoaText}>{c.stores?.name ? `${t('pastryProfile.store')} : ${c.stores.name}` : ''}</T>
            <T size="xs" weight="800" color={c.certified ? PASTRY.pistachio : PASTRY.caramel}>
              {c.certified ? t('pastryProfile.certified') : c.profile_completed_at ? t('pastryProfile.review') : t('pastryProfile.progress', { done: check.done, total: check.total })}
            </T>
          </View>
        </Row>
        <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%`, backgroundColor: pct === 100 ? PASTRY.pistachio : PASTRY.raspberry }]} /></View>
        <Pressable onPress={() => router.push('/me/profile')} accessibilityRole="button" style={styles.account}>
          <Ionicons name="person-circle-outline" size={18} color={PASTRY.choco} />
          <T size="sm" weight="800" color={PASTRY.choco} style={{ flex: 1 }}>{t('pastryProfile.editAccount')}</T>
          <Ionicons name="chevron-forward" size={16} color={PASTRY.choco} />
        </Pressable>
      </View>
      {!profile.phone ? <Notice tone="warning" text={t('pastryProfile.phoneMissing')} /> : null}

      <Section icon="sparkles-outline" title={t('pastryProfile.section.about')} hint={t('pastryProfile.aboutHint')}>
        <Input label={t('pastryProfile.displayName')} value={displayName} onChangeText={setDisplayName} maxLength={80} />
        <Input label={t('pastryProfile.bio')} value={bio} onChangeText={setBio} multiline maxLength={600}
          style={{ minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }} />
        <Input label={t('pastryProfile.years')} value={years} onChangeText={(v) => setYears(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
        <T size="sm" muted>{t('pastryProfile.specialties')}</T>
        <View style={styles.wrap}>
          {[...new Set([...listOf(t, 'pastryProfile.specialtiesList'), ...specialties])].map((s) => (
            <Chip key={s} label={s} active={specialties.includes(s)} icon={specialties.includes(s) ? 'checkmark' : undefined} onPress={() => toggle(s)} />
          ))}
        </View>
        <Row gap={spacing.sm}>
          <View style={{ flex: 1 }}>
            <Input value={custom} onChangeText={setCustom} placeholder={t('pastryProfile.addSpecialty')} maxLength={40} onSubmitEditing={addCustom} />
          </View>
          <Button title="+" variant="secondary" onPress={addCustom} style={{ minHeight: 48, paddingHorizontal: 18 }} />
        </Row>
      </Section>

      <Section icon="person-outline" title={t('pastryProfile.section.identity')}>
        <Input label={t('pastryProfile.birthDate')} value={birth} onChangeText={(v) => setBirth(v.replace(/[^0-9/]/g, '').slice(0, 10))}
          keyboardType="number-pad" placeholder="15/04/1995" error={birth.trim() && !birthIso && birth.length >= 8 ? t('err.INVALID_BIRTH_DATE') : null} />
        <T size="sm" muted>{t('pastryProfile.gender')}</T>
        <View style={styles.wrap}>
          {GENDERS.map((g) => <Chip key={g} label={t(`pastryProfile.gender.${g}` as 'pastryProfile.gender.female')} active={gender === g} onPress={() => setGender(g)} />)}
        </View>
        <Input label={t('pastryProfile.nationality')} value={nationality} onChangeText={setNationality} maxLength={60} />
      </Section>

      <Section icon="id-card-outline" title={t('pastryProfile.section.document')} hint={t('pastryProfile.idPhotoHint')}>
        <T size="sm" muted>{t('pastryProfile.idType')}</T>
        <View style={styles.wrap}>
          {ID_TYPES.map((x) => <Chip key={x} label={t(`pastryProfile.id.${x}` as 'pastryProfile.id.passport')} active={idType === x} onPress={() => setIdType(x)} />)}
        </View>
        <Input label={t('pastryProfile.idNumber')} value={idNumber} onChangeText={setIdNumber} maxLength={40} autoCapitalize="characters" />
        {idPhoto ? (
          <View style={{ gap: spacing.xs }}>
            <T size="sm" muted>{t('pastryProfile.idPhoto')}</T>
            <Image source={{ uri: idPhoto.uri }} style={[styles.idPhoto, { borderColor: colors.border }]} contentFit="cover" />
          </View>
        ) : <PrivatePhoto bucket="pastry-documents" path={c.id_photo_path} label={t('pastryProfile.idPhoto')} height={170} />}
        <Row gap={spacing.sm}>
          <Button style={{ flex: 1 }} title={c.id_photo_path || idPhoto ? t('pastry.photoChange') : t('pastryProfile.idPhotoAdd')} icon="camera-outline" variant="secondary" onPress={() => takeId('camera')} />
          <Button style={{ flex: 1 }} title={t('common.gallery')} icon="images-outline" variant="secondary" onPress={() => takeId('gallery')} />
        </Row>
      </Section>

      <Section icon="home-outline" title={t('pastryProfile.section.address')}>
        <Input label={t('pastryProfile.address')} value={address} onChangeText={setAddress} maxLength={200} />
        <Input label={t('pastryProfile.commune')} value={commune} onChangeText={setCommune} maxLength={80} placeholder="Gombe, Limete, Ngaliema…" />
      </Section>

      <Section icon="medkit-outline" title={t('pastryProfile.section.emergency')}>
        <Input label={t('pastryProfile.emergencyName')} value={emergencyName} onChangeText={setEmergencyName} maxLength={80} />
        <Input label={t('pastryProfile.emergencyPhone')} value={emergencyPhone} onChangeText={setEmergencyPhone} keyboardType="phone-pad" maxLength={30} />
      </Section>

      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      <Button title={t('pastryProfile.save')} icon="save-outline" loading={saving} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, overflow: 'hidden' },
  blob: { position: 'absolute', width: 160, height: 160, borderRadius: 80, opacity: 0.3 },
  hat: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: PASTRY.raspberry, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PASTRY.choco },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PASTRY.cream, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  section: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  sectionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  idPhoto: { height: 170, borderRadius: radius.md, borderWidth: 1 },
});
