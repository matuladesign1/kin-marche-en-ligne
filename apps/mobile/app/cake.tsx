import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { CategoryIcon, PastryBanner } from '@/components/Pastry';
import { Button, Chip, EmptyState, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { useAddresses, useStores } from '@/hooks/data';
import { useMyPastryOrders, usePastrySettings, usePastryStores } from '@/hooks/pastry';
import { errorMessage } from '@/lib/errors';
import {
  PASTRY, PASTRY_CATEGORIES, dayKey, dayLabel, listOf, nextDays, timeLabel, timeSlots,
} from '@/lib/pastry';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import type { PastryCategory } from '@/lib/types';
import { pickImage, randomName, uploadFile, type PickedImage } from '@/lib/upload';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Commande pâtisserie (gâteaux, pains, viennoiseries…) : le client décrit sa commande, choisit le supermarché
// et, s'il le souhaite, le jour et l'heure (dès aujourd'hui, au plus tôt « délai minimum » heures après la demande).
// Le pâtissier propose ensuite un prix ; le client paie seulement après l'avoir accepté.

const SUGGESTIONS: Record<PastryCategory, 'pastry.sugg.cake' | 'pastry.sugg.bread' | 'pastry.sugg.viennoiserie' | 'pastry.sugg.other'> = {
  cake: 'pastry.sugg.cake', bread: 'pastry.sugg.bread', viennoiserie: 'pastry.sugg.viennoiserie', other: 'pastry.sugg.other',
};

function Step({ n, title, children, hint }: { n: number; title: string; children: ReactNode; hint?: string }) {
  const { colors } = useSettings();
  return (
    <View style={[styles.step, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Row gap={spacing.sm}>
        <View style={[styles.stepNum, { backgroundColor: PASTRY.choco }]}><T size="sm" weight="800" color="#FFFFFF">{n}</T></View>
        <T size="lg" weight="800" style={{ flex: 1 }}>{title}</T>
      </Row>
      {hint ? <T size="xs" muted style={{ marginTop: -4 }}>{hint}</T> : null}
      {children}
    </View>
  );
}

export default function PastryOrderForm() {
  const { t, colors, language, selectedStoreId } = useSettings();
  const { session, profile, loading } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const settings = usePastrySettings();
  const pStores = usePastryStores();
  const stores = useStores();
  const addresses = useAddresses();
  const mine = useMyPastryOrders();

  const [category, setCategory] = useState<PastryCategory>('cake');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [designation, setDesignation] = useState('');
  const [size, setSize] = useState<string | null>(null);
  const [servings, setServings] = useState('');
  const [quantity, setQuantity] = useState('');
  const [flavor, setFlavor] = useState('');
  const [color, setColor] = useState('');
  const [inscription, setInscription] = useState('');
  const [details, setDetails] = useState('');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [when, setWhen] = useState<'asap' | 'choose'>('asap');
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Les créneaux se recalculent chaque minute (le délai minimum avance avec l'heure).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (profile) {
      setFullName((v) => v || profile.full_name || '');
      setPhone((v) => v || profile.phone || '');
    }
  }, [profile]);
  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId(addresses.data[0].id);
  }, [addresses.data, addressId]);

  // Supermarchés qui ont un pâtissier, avec leur nom.
  const options = useMemo(() => (pStores.data ?? [])
    .map((p) => ({ ...p, store: stores.data?.find((s) => s.id === p.store_id) }))
    .filter((p) => !!p.store)
    .sort((a, b) => b.certified - a.certified || (a.store!.name).localeCompare(b.store!.name)), [pStores.data, stores.data]);
  useEffect(() => {
    if (storeId && options.some((o) => o.store_id === storeId)) return;
    const preferred = options.find((o) => o.store_id === selectedStoreId) ?? options[0];
    if (preferred) setStoreId(preferred.store_id);
  }, [options, selectedStoreId, storeId]);

  const lead = settings.data?.min_lead_hours ?? 3;
  const days = useMemo(() => nextDays(21, now).map((d) => ({ date: d, key: dayKey(d), slots: timeSlots(d, lead, now) })), [now, lead]);
  const currentDay = days.find((d) => d.key === day) ?? null;
  useEffect(() => {
    if (when !== 'choose') return;
    if (!currentDay || currentDay.slots.length === 0) {
      const first = days.find((d) => d.slots.length > 0);
      setDay(first?.key ?? null);
    }
    // Créneau devenu trop proche : on le retire.
    if (slot && slot < now.getTime() + lead * 3_600_000) setSlot(null);
  }, [when, currentDay, days, slot, now, lead]);

  if (loading || settings.isLoading || pStores.isLoading || stores.isLoading) return <Loading />;

  const header = <Stack.Screen options={{ title: t('pastry.title') }} />;
  const activeCount = (mine.data ?? []).filter((o) => !['delivered', 'rejected', 'cancelled'].includes(o.status)).length;

  const banner = (
    <PastryBanner title={t('pastry.heroTitle')} text={t('pastry.heroText')}>
      <View style={styles.how}>
        {([['create-outline', 'pastry.how1'], ['pricetag-outline', 'pastry.how2'], ['card-outline', 'pastry.how3'], ['bicycle-outline', 'pastry.how4']] as const).map(([icon, key], i) => (
          <View key={key} style={styles.howItem}>
            <View style={styles.howIcon}><Ionicons name={icon} size={16} color={PASTRY.caramel} /></View>
            <T size="xs" color="#FFFFFF" style={{ textAlign: 'center', lineHeight: 15 }}>{`${i + 1}. ${t(key)}`}</T>
          </View>
        ))}
      </View>
      {session ? (
        <Pressable onPress={() => router.push('/pastry-orders')} accessibilityRole="button" style={styles.mineBtn}>
          <MaterialCommunityIcons name="receipt" size={16} color={PASTRY.choco} />
          <T size="sm" weight="800" color={PASTRY.choco}>{t('pastry.myOrders')}</T>
          {activeCount ? <View style={styles.mineCount}><T size="xs" weight="800" color="#FFFFFF">{activeCount}</T></View> : null}
          <Ionicons name="chevron-forward" size={16} color={PASTRY.choco} />
        </Pressable>
      ) : null}
    </PastryBanner>
  );

  if (!session) {
    return (
      <Screen>
        {header}
        {banner}
        <EmptyState icon="person-circle-outline" message={t('pastry.signIn')} action={t('auth.signIn')} onAction={() => router.push('/sign-in')} />
      </Screen>
    );
  }
  if (settings.data && !settings.data.enabled) {
    return <Screen>{header}{banner}<Notice tone="warning" text={t('pastry.closed')} /></Screen>;
  }
  if (options.length === 0) {
    return <Screen>{header}{banner}<EmptyState icon="storefront-outline" message={t('pastry.noStores')} /></Screen>;
  }

  const attach = async (source: 'camera' | 'gallery') => {
    const img = await pickImage(source);
    if (img === 'denied') return Alert.alert(t('pastry.photo'), t('search.cameraDenied'));
    if (img) setPhoto(img);
  };

  const submit = async () => {
    setError(null);
    if (!storeId) return setError(t('pastry.errStore'));
    if (!designation.trim()) return setError(t('pastry.errDesignation'));
    if (!fullName.trim() || phone.replace(/\D/g, '').length < 9) return setError(t('pastry.errContact'));
    if (when === 'choose' && !slot) return setError(t('pastry.errTime'));
    setSaving(true);
    try {
      const photoPath = photo ? await uploadFile('cake-references', `${uid}/${randomName(photo.ext)}`, photo) : null;
      const a = addresses.data?.find((x) => x.id === addressId);
      const isCake = category === 'cake';
      const created = unwrap(await supabase.from('cake_orders').insert({
        customer_id: uid,
        store_id: storeId,
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: session.user.email ?? null,
        category,
        cake_type: designation.trim(),
        size: isCake ? size : null,
        servings: isCake && Number(servings) > 0 ? Math.round(Number(servings)) : null,
        quantity: !isCake && Number(quantity) > 0 ? Math.round(Number(quantity)) : null,
        flavor: isCake ? flavor.trim() || null : null,
        color: isCake ? color.trim() || null : null,
        inscription: isCake ? inscription.trim() || null : null,
        details: details.trim() || null,
        reference_photo_path: photoPath,
        desired_at: when === 'choose' && slot ? new Date(slot).toISOString() : null,
        delivery_address: a ? {
          id: a.id, label: a.label, commune: a.commune, quartier: a.quartier, avenue: a.avenue,
          street_number: a.street_number, landmark: a.landmark, latitude: a.latitude, longitude: a.longitude,
        } : null,
      }).select('id').single()) as { id: string };
      qc.invalidateQueries({ queryKey: ['pastry', 'mine'] });
      router.replace({ pathname: '/pastry-orders/[id]', params: { id: created.id, sent: '1' } });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  const isCake = category === 'cake';
  return (
    <Screen>
      {header}
      {banner}

      <Step n={1} title={t('pastry.step.what')}>
        <View style={styles.cats}>
          {PASTRY_CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <Pressable key={c} onPress={() => { setCategory(c); setDesignation(''); }} accessibilityRole="button" accessibilityState={{ selected: active }}
                style={[styles.cat, { borderColor: active ? PASTRY.raspberry : colors.border, backgroundColor: active ? `${PASTRY.raspberry}12` : colors.background }]}>
                <CategoryIcon category={c} size={46} />
                <T weight={active ? '800' : '600'} color={active ? PASTRY.raspberryDeep : colors.text}>{t(`pastry.cat.${c}` as 'pastry.cat.cake')}</T>
                {active ? <View style={styles.catCheck}><Ionicons name="checkmark-circle" size={20} color={PASTRY.raspberry} /></View> : null}
              </Pressable>
            );
          })}
        </View>
      </Step>

      <Step n={2} title={t('pastry.step.store')}>
        {options.map((o) => {
          const active = o.store_id === storeId;
          return (
            <Pressable key={o.store_id} onPress={() => setStoreId(o.store_id)} accessibilityRole="radio" accessibilityState={{ checked: active }}
              style={[styles.store, { borderColor: active ? PASTRY.raspberry : colors.border }]}>
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? PASTRY.raspberry : colors.textMuted} />
              <View style={{ flex: 1, gap: 2 }}>
                <T weight="800" numberOfLines={1}>{o.store!.name}</T>
                <Row gap={6}>
                  <MaterialCommunityIcons name="chef-hat" size={14} color={colors.textMuted} />
                  <T size="xs" muted>{t('pastry.chefsCount', { n: o.chefs })}</T>
                  {o.certified ? (
                    <Row gap={3}>
                      <CertifiedBadge size={13} label={t('pastry.certifiedChef')} />
                      <T size="xs" weight="700" color={colors.success}>{t('pastry.certifiedCount', { n: o.certified })}</T>
                    </Row>
                  ) : null}
                </Row>
              </View>
              {!o.store!.is_open ? <T size="xs" weight="700" color={colors.textMuted}>{t('stores.closed')}</T> : null}
            </Pressable>
          );
        })}
      </Step>

      <Step n={3} title={t('pastry.step.details')}>
        <Input label={t('pastry.designation')} value={designation} onChangeText={setDesignation} maxLength={120}
          placeholder={t(`pastry.designationHint.${category}` as 'pastry.designationHint.cake')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {listOf(t, SUGGESTIONS[category]).map((s) => (
            <Chip key={s} label={s} active={designation === s} onPress={() => setDesignation(s)} />
          ))}
        </ScrollView>

        {isCake ? (
          <>
            <T size="sm" muted>{t('pastry.size')}</T>
            <View style={styles.wrap}>
              {listOf(t, 'pastry.sizes').map((s) => <Chip key={s} label={s} active={size === s} onPress={() => setSize(size === s ? null : s)} />)}
            </View>
            <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Input label={t('pastry.servings')} value={servings} onChangeText={(v) => setServings(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="12" />
              </View>
              <View style={{ flex: 1.4 }}>
                <Input label={t('pastry.color')} value={color} onChangeText={setColor} maxLength={80} placeholder={t('pastry.colorHint')} />
              </View>
            </Row>
            <T size="sm" muted>{t('pastry.flavor')}</T>
            <View style={styles.wrap}>
              {listOf(t, 'pastry.flavors').map((s) => <Chip key={s} label={s} active={flavor === s} onPress={() => setFlavor(flavor === s ? '' : s)} />)}
            </View>
            <Input label={t('pastry.inscription')} value={inscription} onChangeText={setInscription} maxLength={80} placeholder={t('pastry.inscriptionHint')} />
          </>
        ) : (
          <Input label={t('pastry.quantity')} value={quantity} onChangeText={(v) => setQuantity(v.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" placeholder="10" />
        )}

        <Input label={t('pastry.details')} value={details} onChangeText={setDetails} multiline maxLength={2000}
          placeholder={t('pastry.detailsHint')} style={{ minHeight: 92, textAlignVertical: 'top', paddingTop: 12 }} />

        <T size="sm" muted>{t('pastry.photo')}</T>
        {photo ? (
          <View style={[styles.photoBox, { borderColor: colors.border }]}>
            <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Button title={t('pastry.photoChange')} icon="images-outline" variant="secondary" onPress={() => attach('gallery')} />
              <Button title={t('pastry.photoRemove')} icon="trash-outline" variant="ghost" onPress={() => setPhoto(null)} />
            </View>
          </View>
        ) : (
          <Row gap={spacing.sm}>
            <Button style={{ flex: 1 }} title={t('common.gallery')} icon="images-outline" variant="secondary" onPress={() => attach('gallery')} />
            <Button style={{ flex: 1 }} title={t('common.camera')} icon="camera-outline" variant="secondary" onPress={() => attach('camera')} />
          </Row>
        )}
      </Step>

      <Step n={4} title={t('pastry.step.when')} hint={t('pastry.leadHint', { h: lead })}>
        <Row gap={spacing.sm}>
          {(['asap', 'choose'] as const).map((w) => {
            const active = when === w;
            return (
              <Pressable key={w} onPress={() => setWhen(w)} accessibilityRole="radio" accessibilityState={{ checked: active }}
                style={[styles.whenOpt, { borderColor: active ? PASTRY.raspberry : colors.border, backgroundColor: active ? `${PASTRY.raspberry}12` : colors.background }]}>
                <Ionicons name={w === 'asap' ? 'flash-outline' : 'calendar-outline'} size={20} color={active ? PASTRY.raspberry : colors.textMuted} />
                <T size="sm" weight="800" color={active ? PASTRY.raspberryDeep : colors.text} style={{ textAlign: 'center' }}>
                  {w === 'asap' ? t('pastry.asap') : t('pastry.chooseDate')}
                </T>
              </Pressable>
            );
          })}
        </Row>
        {when === 'asap' ? <T size="xs" muted>{t('pastry.asapHint')}</T> : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
              {days.map((d) => {
                const active = d.key === day;
                const off = d.slots.length === 0;
                const l = dayLabel(d.date, language, t, now);
                return (
                  <Pressable key={d.key} disabled={off} onPress={() => { setDay(d.key); setSlot(null); }} accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: off }}
                    style={[styles.day, {
                      backgroundColor: active ? PASTRY.choco : colors.background,
                      borderColor: active ? PASTRY.choco : colors.border, opacity: off ? 0.4 : 1,
                    }]}>
                    <T size="xs" weight="700" color={active ? PASTRY.caramel : colors.textMuted}>{l.top}</T>
                    <T weight="800" color={active ? '#FFFFFF' : colors.text}>{l.bottom}</T>
                  </Pressable>
                );
              })}
            </ScrollView>
            {days[0].slots.length === 0 && day === days[1]?.key ? <T size="xs" muted>{t('pastry.noSlotToday')}</T> : null}
            <T size="sm" muted>{t('pastry.pickTime')}</T>
            <View style={styles.wrap}>
              {(currentDay?.slots ?? []).map((s) => {
                const active = slot === s.getTime();
                return (
                  <Pressable key={s.getTime()} onPress={() => setSlot(s.getTime())} accessibilityRole="button" accessibilityState={{ selected: active }}
                    style={[styles.time, { backgroundColor: active ? PASTRY.raspberry : colors.background, borderColor: active ? PASTRY.raspberry : colors.border }]}>
                    <T size="sm" weight="700" color={active ? '#FFFFFF' : colors.text}>{timeLabel(s)}</T>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </Step>

      <Step n={5} title={t('pastry.step.contact')}>
        <Input label={t('auth.fullName')} value={fullName} onChangeText={setFullName} maxLength={80} autoComplete="name" />
        <Input label={t('auth.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} placeholder="+243 81 000 0000" />
        <T size="sm" muted>{t('pastry.address')}</T>
        {(addresses.data ?? []).length ? (
          <View style={styles.wrap}>
            {(addresses.data ?? []).map((a) => (
              <Chip key={a.id} icon="home-outline" label={`${a.label} · ${a.commune}`} active={a.id === addressId} onPress={() => setAddressId(a.id)} />
            ))}
          </View>
        ) : null}
        <Button title={t('pastry.addAddress')} icon="add-circle-outline" variant="ghost" onPress={() => router.push('/addresses/new')} />
        <T size="xs" muted>{t('pastry.addressHint')}</T>
      </Step>

      {error ? <Notice tone="danger" text={error} /> : null}
      <Button title={t('pastry.submit')} icon="send-outline" loading={saving} onPress={submit} />
      <Row gap={6} style={{ justifyContent: 'center' }}>
        <Ionicons name="shield-checkmark-outline" size={15} color={colors.success} />
        <T size="xs" muted style={{ textAlign: 'center', flexShrink: 1 }}>{t('pastry.submitHint')}</T>
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  how: { flexDirection: 'row', gap: spacing.xs },
  howItem: { flex: 1, alignItems: 'center', gap: 6 },
  howIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  mineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: PASTRY.cream,
    borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9,
  },
  mineCount: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: PASTRY.raspberry, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cat: { flexBasis: '47%', flexGrow: 1, borderWidth: 2, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', gap: 6 },
  catCheck: { position: 'absolute', top: 8, right: 8 },
  store: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoBox: { flexDirection: 'row', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
  photo: { width: 110, height: 110, borderRadius: radius.md },
  whenOpt: { flex: 1, borderWidth: 2, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, alignItems: 'center', gap: 6 },
  day: { width: 74, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', gap: 2 },
  time: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, minWidth: 72, alignItems: 'center' },
});
