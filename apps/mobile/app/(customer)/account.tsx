import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Dimensions, FlatList, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { BasketLoader } from '@/components/BasketLoader';
import { Avatar, GradientBg, IconTile, Panel, PanelHeader, WheelIcon } from '@/components/kit';
import { LoyaltyCardMini } from '@/components/LoyaltyCard';
import { Button, Row, T, type IconName } from '@/components/ui';
import {
  useAddresses, useFavoritePreview, useLoyalty, useMyCoupons, useOrderCounts, useRecentItems, useWheel,
} from '@/hooks/data';
import { isTier } from '@/lib/loyalty';
import type { OrderTab } from '@/lib/orders';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

interface Partner { id: string; name: string; logo_url: string | null; website: string | null }

const PARTNER_PAGE = 60;
const COLS = 3;
const CELL = (Dimensions.get('window').width - spacing.md * 2) / COLS;

/** Tous les partenaires (même plusieurs milliers), chargés au fil du défilement. */
function usePartners() {
  return useInfiniteQuery({
    queryKey: ['partners-all'],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => ((await supabase.from('partners').select('id, name, logo_url, website')
      .eq('is_active', true).order('sort_order').order('name').order('id')
      .range(pageParam, pageParam + PARTNER_PAGE - 1)).data ?? []) as Partner[],
    getNextPageParam: (last, all) => (last.length < PARTNER_PAGE ? undefined : all.length * PARTNER_PAGE),
  });
}

/** Aperçu de la carte Kin Marché Fidélité (touchez pour l'afficher en grand). */
function AccountLoyaltyCard() {
  const { t } = useSettings();
  const q = useLoyalty();
  if (!q.data) return null;
  const { card } = q.data;
  const has = card.card_status !== 'none' && !!card.card_number && isTier(card.tier);
  return (
    <Pressable onPress={() => router.push('/loyalty')} accessibilityRole="button" accessibilityHint={t('loyalty.open')}>
      <LoyaltyCardMini
        number={has ? card.card_number : card.phone_card_number}
        name={card.full_name}
        tier={has && isTier(card.tier) ? card.tier : 'silver'}
        points={has ? card.points_balance : undefined}
        suspended={card.card_status === 'suspended'}
        pending={!has}
      />
    </Pressable>
  );
}

function HeaderIcon({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={styles.headerIcon}>
      <Ionicons name={icon} size={26} color={colors.text} />
    </Pressable>
  );
}

/** Carte « Favoris » / « Historique » / « Coupons » avec vignette à droite. */
function QuickCard({ label, image, icon, onPress }: { label: string; image?: string | null; icon: IconName; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.quick, { backgroundColor: colors.surface, opacity: pressed ? 0.88 : 1 }]}>
      <T size="sm" weight="700" numberOfLines={2} style={{ flex: 1 }}>{label}</T>
      <View style={[styles.quickThumb, { backgroundColor: colors.surfaceAlt }]}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name={icon} size={22} color={colors.textMuted} />}
      </View>
    </Pressable>
  );
}

function PromoCard({ title, text, icon, tint, onPress }: { title: string; text: string; icon: ReactNode; tint: string; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.promo, { backgroundColor: tint, opacity: pressed ? 0.9 : 1 }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <T weight="800" numberOfLines={2} color="#7A2E0E">{title}</T>
        <Row gap={2}>
          <T size="sm" numberOfLines={1} color="#7A2E0E" style={{ flexShrink: 1 }}>{text}</T>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </Row>
      </View>
      {icon}
    </Pressable>
  );
}

export default function Account() {
  const { t, colors, money } = useSettings();
  const { session, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const partners = usePartners();
  const partnerList = partners.data?.pages.flat() ?? [];
  const addresses = useAddresses();
  const favorites = useFavoritePreview();
  const recent = useRecentItems(1);
  const coupons = useMyCoupons();
  const wheel = useWheel();
  const { counts } = useOrderCounts();
  const [allFeatures, setAllFeatures] = useState(false);

  const need = (href: string) => () => router.push((session ? href : '/(auth)/sign-in') as never);
  const commune = addresses.data?.find((a) => a.is_default)?.commune ?? addresses.data?.[0]?.commune ?? null;
  const spins = wheel.data?.spins_available ?? 0;
  const wheelOn = !!wheel.data?.enabled && (wheel.data?.prizes.length ?? 0) > 0;

  const orderTiles: { tab: OrderTab; icon: IconName }[] = [
    { tab: 'toPay', icon: 'card-outline' },
    { tab: 'toShip', icon: 'cube-outline' },
    { tab: 'toReceive', icon: 'bicycle-outline' },
    { tab: 'refund', icon: 'arrow-undo-outline' },
    { tab: 'toReview', icon: 'star-outline' },
  ];

  const features: { key: string; icon: IconName; label: string; onPress: () => void }[] = [
    { key: 'addresses', icon: 'location-outline', label: t('account.feature.addresses'), onPress: need('/addresses') },
    { key: 'stores', icon: 'storefront-outline', label: t('stores.title'), onPress: () => router.push('/stores') },
    { key: 'support', icon: 'headset-outline', label: t('home.support'), onPress: need('/support') },
    { key: 'notifications', icon: 'notifications-outline', label: t('account.notifications'), onPress: need('/notifications') },
    { key: 'cakes', icon: 'gift-outline', label: t('home.cakes'), onPress: () => router.push('/cake') },
    { key: 'favorites', icon: 'heart-outline', label: t('favorites.title'), onPress: need('/favorites') },
    { key: 'driver', icon: 'bicycle-outline', label: t('account.feature.driver'), onPress: need('/driver-signup') },
    { key: 'about', icon: 'information-circle-outline', label: t('about.title'), onPress: () => router.push('/about') },
    { key: 'rate', icon: 'star-half-outline', label: t('account.feature.rate'), onPress: need('/me/rate') },
    { key: 'settings', icon: 'settings-outline', label: t('settings.title'), onPress: () => router.push('/settings') },
  ];

  const header = (
    <View style={{ gap: spacing.md }}>
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.lg }}>
        <GradientBg from={colors.primarySoft} to={colors.background} />
        <Row gap={spacing.md}>
          <Pressable onPress={need('/me/profile')} accessibilityRole="button" accessibilityLabel={t('account.editProfile')}>
            <Avatar uri={profile?.avatar_url} name={profile?.full_name ?? profile?.email} size={60} />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            {session && profile ? (
              <>
                <Pressable onPress={() => router.push('/me/profile')} style={styles.nameRow} accessibilityRole="button">
                  <T size="xl" weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{profile.full_name || profile.email}</T>
                  <Ionicons name="chevron-down" size={18} color={colors.text} />
                </Pressable>
                <Pressable onPress={() => router.push('/addresses')} style={styles.nameRow} accessibilityRole="button">
                  <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                  <T size="sm" muted>{t('home.deliverTo')}</T>
                  <T size="sm" weight="600" style={{ textDecorationLine: 'underline' }} numberOfLines={1}>{commune ?? t('account.addAddress')}</T>
                </Pressable>
              </>
            ) : (
              <>
                <T size="lg" weight="800">{t('account.welcomeGuest')}</T>
                <T size="sm" muted>{t('account.welcomeGuestText')}</T>
              </>
            )}
          </View>
          <HeaderIcon icon="headset-outline" label={t('home.support')} onPress={need('/support')} />
          <HeaderIcon icon="qr-code-outline" label={t('loyalty.title')} onPress={need('/loyalty')} />
          <HeaderIcon icon="settings-outline" label={t('settings.title')} onPress={() => router.push('/settings')} />
        </Row>
        {!session ? (
          <Row>
            <Button style={{ flex: 1 }} title={t('auth.signIn')} onPress={() => router.push('/(auth)/sign-in')} />
            <Button style={{ flex: 1 }} title={t('auth.signUp')} variant="secondary" onPress={() => router.push('/(auth)/sign-up')} />
          </Row>
        ) : null}
        <Row gap={spacing.sm}>
          <QuickCard label={t('favorites.title')} image={favorites.image} icon="heart-outline" onPress={need('/favorites')} />
          <QuickCard label={t('account.history')} image={recent.items?.[0]?.image_url} icon="time-outline" onPress={() => router.push('/recent')} />
          <QuickCard label={`${t('coupons.title')}${coupons.data?.length ? ` (${coupons.data.length})` : ''}`} icon="pricetags-outline" onPress={() => router.push('/coupons')} />
        </Row>
      </View>

      <View style={{ paddingHorizontal: spacing.md, gap: spacing.md }}>
        {wheelOn ? (
          <Pressable onPress={need('/wheel')} accessibilityRole="button"
            style={({ pressed }) => [styles.banner, { backgroundColor: colors.surface, opacity: pressed ? 0.9 : 1 }]}>
            <WheelIcon size={34} />
            <T style={{ flex: 1 }} numberOfLines={2}>
              {spins > 0
                ? <><T weight="800" color={colors.primary}>{t('wheel.title')}</T>{' · '}{spins === 1 ? t('account.wheelOne') : t('account.wheelMany', { n: spins })}</>
                : <>{t('account.wheelEarn', { amount: money(wheel.data?.min_order_usd ?? 50) })}</>}
            </T>
            <Ionicons name="arrow-forward" size={22} color={colors.text} />
          </Pressable>
        ) : null}

        <Panel>
          <PanelHeader title={t('orders.mine')} action={t('common.seeAll')} onAction={need('/orders')} />
          <Row gap={0} style={{ alignItems: 'flex-start' }}>
            {orderTiles.map((o) => (
              <IconTile key={o.tab} icon={o.icon} label={t(`orders.tab.${o.tab}`)} count={session ? counts[o.tab] : 0}
                onPress={need(`/orders?tab=${o.tab}`)} />
            ))}
          </Row>
        </Panel>

        <Panel>
          <PanelHeader title={t('account.section.rewards')} action={t('account.seeCard')} onAction={need('/loyalty')} />
          {session ? <AccountLoyaltyCard /> : null}
          <Row gap={0} style={{ alignItems: 'flex-start' }}>
            <IconTile width="25%" icon="card-outline" label={t('account.loyaltyCard')} onPress={need('/loyalty')} />
            {wheelOn ? <IconTile width="25%" custom={<WheelIcon size={28} />} label={t('wheel.title')} count={spins} onPress={need('/wheel')} /> : null}
            {wheelOn ? <IconTile width="25%" icon="trophy-outline" label={t('wheel.myRewards')} onPress={need('/wheel?section=rewards')} /> : null}
            <IconTile width="25%" icon="pricetags-outline" label={t('coupons.title')} onPress={() => router.push('/coupons')} />
          </Row>
        </Panel>

        <Panel>
          <PanelHeader title={t('account.moreFeatures')} action={allFeatures ? t('account.lessFeatures') : t('account.allFeatures')}
            onAction={() => setAllFeatures((v) => !v)} size="md" />
          <Row gap={0} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {(allFeatures ? features : features.slice(0, 4)).map(({ key, ...f }) => <IconTile key={key} width="25%" {...f} />)}
          </Row>
        </Panel>

        <Row gap={spacing.sm}>
          <PromoCard title={t('cake.title')} text={t('account.promo.cakeText')} tint="#FFF1E6"
            icon={<Ionicons name="gift" size={34} color="#FF6A00" />} onPress={() => router.push('/cake')} />
          <PromoCard title={t('account.promo.driverTitle')} text={t('account.promo.driverText')} tint="#FFF6DD"
            icon={<Ionicons name="bicycle" size={34} color="#E8A317" />} onPress={need('/driver-signup')} />
        </Row>

        {partnerList.length > 0 ? (
          <View style={{ gap: 4, marginTop: spacing.sm }}>
            <PanelHeader title={t('partners.title')} />
            <T size="sm" muted>{t('partners.subtitle', { n: partnerList.length + (partners.hasNextPage ? '+' : '') })}</T>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      data={partnerList}
      numColumns={COLS}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={header}
      columnWrapperStyle={{ paddingHorizontal: spacing.md }}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => (item.website && /^https?:\/\//.test(item.website) ? Linking.openURL(item.website) : undefined)}
          accessibilityRole={item.website ? 'link' : 'image'}
          accessibilityLabel={item.name}
          style={{ width: CELL, height: 76, alignItems: 'center', justifyContent: 'center', padding: spacing.sm }}
        >
          {item.logo_url ? (
            <Image source={{ uri: item.logo_url }} style={{ width: CELL - spacing.xl, height: 48 }} contentFit="contain" transition={200} />
          ) : (
            <T size="sm" weight="700" muted numberOfLines={2} style={{ textAlign: 'center' }}>{item.name}</T>
          )}
        </Pressable>
      )}
      onEndReached={() => { if (partners.hasNextPage && !partners.isFetchingNextPage) partners.fetchNextPage(); }}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        <View>
          {partners.isFetchingNextPage ? <BasketLoader size="mini" showLabel={false} /> : null}
          {!partners.hasNextPage ? <AppFooter /> : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  headerIcon: { width: 34, alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quick: { flex: 1, minHeight: 64, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: spacing.md, paddingRight: 8 },
  quickThumb: { width: 40, height: 40, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  promo: { flex: 1, minHeight: 88, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
});
