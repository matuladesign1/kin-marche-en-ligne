import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { BrandLogo } from '@/components/BrandHeader';
import { Button, Card, Row, Screen, SectionHeader, T, type IconName } from '@/components/ui';
import type { TranslationKey } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

const FEATURES: { icon: IconName; title: TranslationKey; text: TranslationKey }[] = [
  { icon: 'cart-outline', title: 'about.f.order', text: 'about.f.orderText' },
  { icon: 'bicycle-outline', title: 'about.f.delivery', text: 'about.f.deliveryText' },
  { icon: 'shield-checkmark-outline', title: 'about.f.payment', text: 'about.f.paymentText' },
  { icon: 'navigate-outline', title: 'about.f.tracking', text: 'about.f.trackingText' },
  { icon: 'star-outline', title: 'about.f.loyalty', text: 'about.f.loyaltyText' },
  { icon: 'gift-outline', title: 'about.f.cakes', text: 'about.f.cakesText' },
  { icon: 'chatbubbles-outline', title: 'about.f.assistant', text: 'about.f.assistantText' },
];

// Photos officielles Kin Marché (magasin, chambre froide, entrepôt, centre logistique, rayons).
const HERO = require('../assets/images/about/magasin.jpg');
const PHOTOS: { src: number; title: TranslationKey; text: TranslationKey; ratio: number }[] = [
  { src: require('../assets/images/about/chambre-froide.jpg'), title: 'about.photo.cold', text: 'about.photo.coldText', ratio: 600 / 322 },
  { src: require('../assets/images/about/rayons.jpg'), title: 'about.photo.aisles', text: 'about.photo.aislesText', ratio: 600 / 322 },
  { src: require('../assets/images/about/entrepot.jpg'), title: 'about.photo.warehouse', text: 'about.photo.warehouseText', ratio: 600 / 322 },
  { src: require('../assets/images/about/centre-logistique.jpg'), title: 'about.photo.logistics', text: 'about.photo.logisticsText', ratio: 600 / 322 },
];

const PROMISES: { icon: IconName; text: TranslationKey }[] = [
  { icon: 'pricetags-outline', text: 'about.p.prices' },
  { icon: 'lock-closed-outline', text: 'about.p.noCash' },
  { icon: 'key-outline', text: 'about.p.code' },
  { icon: 'chatbox-ellipses-outline', text: 'about.p.reviews' },
  { icon: 'finger-print-outline', text: 'about.p.privacy' },
];

export default function About() {
  const { t, colors } = useSettings();
  const [zoom, setZoom] = useState<{ src: number; title: TranslationKey; ratio: number } | null>(null);
  const stats = useQuery({
    queryKey: ['about-stats'],
    queryFn: async () => {
      const count = async (table: string, f: (q: any) => any) => (await f(supabase.from(table).select('id', { count: 'exact', head: true }))).count ?? 0;
      const [stores, categories, partners] = await Promise.all([
        count('stores', (q) => q.eq('is_active', true)),
        count('product_categories', (q) => q.eq('is_active', true)),
        count('partners', (q) => q.eq('is_active', true)),
      ]);
      return { stores, categories, partners };
    },
  });

  return (
    <Screen>
      {/* Bandeau photo : la façade d'un supermarché Kin Marché */}
      <Pressable onPress={() => setZoom({ src: HERO, title: 'about.photo.stores', ratio: 1440 / 753 })} accessibilityRole="imagebutton" accessibilityLabel={t('about.photo.stores')}>
        <View style={[styles.cover, { borderColor: colors.border }]}>
          <Image source={HERO} style={{ width: '100%', aspectRatio: 1440 / 753 }} contentFit="cover" transition={250} />
          <View style={styles.coverShade}>
            <T size="xs" weight="800" color="#FFFFFF" style={{ letterSpacing: 1.5 }}>{t('about.photo.storesKicker')}</T>
            <T size="lg" weight="800" color="#FFFFFF">{t('about.photo.stores')}</T>
            <T size="sm" color="#F2F3F5">{t('about.photo.storesText')}</T>
          </View>
        </View>
      </Pressable>

      <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <BrandLogo height={52} />
        <T size="lg" weight="800" color={colors.primary} style={{ textAlign: 'center' }}>{t('app.tagline')}</T>
        <T style={{ textAlign: 'center', lineHeight: 22 }}>{t('about.intro')}</T>
      </View>

      <Row gap={8}>
        {([
          { v: stats.data?.stores, l: t('about.stats.stores'), c: colors.primary, i: 'storefront' },
          { v: stats.data?.categories, l: t('about.stats.categories'), c: colors.accent, i: 'grid' },
          { v: stats.data?.partners, l: t('about.stats.partners'), c: colors.accent2, i: 'ribbon' },
        ] as const).map((s) => (
          <View key={s.l} style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name={s.i} size={20} color={s.c} />
            <T size="xl" weight="800">{s.v ?? '—'}</T>
            <T size="xs" muted style={{ textAlign: 'center' }}>{s.l}</T>
          </View>
        ))}
      </Row>

      {/* Galerie : l'envers du décor, de la chambre froide au rayon */}
      <SectionHeader title={t('about.galleryTitle')} />
      <T size="sm" muted style={{ marginTop: -6 }}>{t('about.gallerySubtitle')}</T>
      <View style={styles.grid}>
        {PHOTOS.map((p) => (
          <Pressable key={p.title} style={styles.tile} onPress={() => setZoom(p)} accessibilityRole="imagebutton" accessibilityLabel={t(p.title)}>
            <View style={[styles.tileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Image source={p.src} style={{ width: '100%', aspectRatio: p.ratio }} contentFit="cover" transition={250} />
              <View style={{ padding: spacing.sm, gap: 2 }}>
                <T size="sm" weight="800" numberOfLines={1}>{t(p.title)}</T>
                <T size="xs" muted numberOfLines={3} style={{ lineHeight: 16 }}>{t(p.text)}</T>
              </View>
            </View>
          </Pressable>
        ))}
      </View>

      <SectionHeader title={t('about.whatTitle')} />
      <Card style={{ gap: spacing.md }}>
        {FEATURES.map((f) => (
          <Row key={f.title} gap={12} style={{ alignItems: 'flex-start' }}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}><Ionicons name={f.icon} size={20} color={colors.primary} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="700">{t(f.title)}</T>
              <T size="sm" muted style={{ lineHeight: 19 }}>{t(f.text)}</T>
            </View>
          </Row>
        ))}
      </Card>

      <SectionHeader title={t('about.promiseTitle')} />
      <Card style={{ gap: spacing.md }}>
        {PROMISES.map((p) => (
          <Row key={p.text} gap={12} style={{ alignItems: 'flex-start' }}>
            <Ionicons name={p.icon} size={20} color={colors.accent2} />
            <T size="sm" style={{ flex: 1, lineHeight: 20 }}>{t(p.text)}</T>
          </Row>
        ))}
      </Card>

      <SectionHeader title={t('about.appTitle')} />
      <Card>
        <Row style={{ justifyContent: 'space-between' }}><T muted>{t('about.version')}</T><T weight="700">{Application.nativeApplicationVersion ?? '0.1.0'}</T></Row>
        <Row style={{ justifyContent: 'space-between' }}><T muted>{t('settings.language')}</T><T weight="700" style={{ flex: 1, textAlign: 'right' }}>{LANGUAGES.map((l) => l.label).join(' · ')}</T></Row>
        <Row style={{ justifyContent: 'space-between' }}><T muted>{t('settings.currency')}</T><T weight="700">USD · CDF · EUR</T></Row>
      </Card>

      <SectionHeader title={t('about.contactTitle')} />
      <Card>
        <T size="sm" muted>{t('about.contactText')}</T>
        <Button title={t('inbox.newChat')} icon="chatbubbles-outline" onPress={() => router.push('/support')} />
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {(['terms', 'privacy', 'license'] as const).map((d) => (
            <Pressable key={d} onPress={() => router.push(`/legal/${d}`)} hitSlop={6}>
              <T size="sm" weight="600" color={colors.accent}>{t(`account.${d}` as TranslationKey)}</T>
            </Pressable>
          ))}
        </Row>
      </Card>

      <SectionHeader title={t('about.devTitle')} />
      <Card>
        <T weight="800">MATULA DESIGN</T>
        <T size="sm" muted>{t('about.devText')}</T>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <Button title="+243 849 009 239" variant="ghost" icon="call-outline" onPress={() => Linking.openURL('tel:+243849009239')} />
          <Button title="omalbac@gmail.com" variant="ghost" icon="mail-outline" onPress={() => Linking.openURL('mailto:omalbac@gmail.com')} />
        </Row>
      </Card>

      <AppFooter />

      {/* Plein écran : toucher pour fermer */}
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)} statusBarTranslucent>
        <Pressable style={styles.lightbox} onPress={() => setZoom(null)} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          {zoom ? (
            <View style={{ width: '100%', gap: spacing.md }}>
              <Image source={zoom.src} style={{ width: '100%', aspectRatio: zoom.ratio }} contentFit="contain" />
              <T weight="700" color="#FFFFFF" style={{ textAlign: 'center' }}>{t(zoom.title)}</T>
            </View>
          ) : null}
          <View style={styles.close}><Ionicons name="close" size={26} color="#FFFFFF" /></View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1 },
  coverShade: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: 'rgba(0,0,0,0.45)', gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  tile: { width: '48.5%' },
  tileCard: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden', flex: 1 },
  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  close: { position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  hero: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, alignItems: 'center' },
  stat: { flex: 1, borderWidth: 1, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', gap: 2 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
