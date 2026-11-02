import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BannerCarousel } from '@/components/BannerCarousel';
import { BrandLogo } from '@/components/BrandHeader';
import { ProductFeedList } from '@/components/ProductFeedList';
import { ProductRail } from '@/components/product';
import { Card, Chip, EmptyState, Row, SectionHeader, T, type IconName } from '@/components/ui';
import { useCategories, useHomeSection, useStores } from '@/hooks/data';
import { localized } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

function HeaderIcon({ icon, label, count, onPress }: { icon: IconName; label: string; count?: number; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={[styles.headerIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Ionicons name={icon} size={22} color={colors.text} />
      {count ? (
        <View style={[styles.dot, { backgroundColor: colors.primary, borderColor: colors.background }]}>
          <T size="xs" weight="700" color={colors.onPrimary}>{count > 99 ? '99+' : count}</T>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function Home() {
  const { colors, t, language, selectedStoreId, setSelectedStoreId } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const stores = useStores();
  const categories = useCategories();
  const best = useHomeSection('best', selectedStoreId);
  const fresh = useHomeSection('new', selectedStoreId);
  const promo = useHomeSection('promo', selectedStoreId);
  const featured = useHomeSection('featured', selectedStoreId);
  const local = useHomeSection('local', selectedStoreId);

  // Messages non lus de l'assistance (RLS : uniquement mes conversations).
  const unread = useQuery({
    queryKey: ['unread-messages'],
    enabled: !!session,
    refetchInterval: 30_000,
    queryFn: async () => (await supabase.from('messages').select('id', { count: 'exact', head: true })
      .is('read_at', null).neq('sender_id', session!.user.id)).count ?? 0,
  });

  const selectedStore = stores.data?.find((s) => s.id === selectedStoreId);
  useEffect(() => {
    // Magasin supprimé ou désactivé : on revient à « tous les magasins ».
    if (selectedStoreId && stores.data && !selectedStore) setSelectedStoreId(null);
  }, [selectedStoreId, stores.data, selectedStore, setSelectedStoreId]);

  const anyProducts = [best, fresh, promo, featured, local].some((q) => (q.data?.length ?? 0) > 0);

  const quick: { icon: IconName; label: string; href: string }[] = [
    { icon: 'receipt-outline', label: t('home.quickOrders'), href: '/(customer)/orders' },
    { icon: 'heart-outline', label: t('home.favorites'), href: '/favorites' },
    { icon: 'star-outline', label: t('home.loyalty'), href: '/loyalty' },
    { icon: 'pricetag-outline', label: t('home.coupons'), href: '/coupons' },
    { icon: 'gift-outline', label: t('home.cakes'), href: '/cake' },
    { icon: 'chatbubbles-outline', label: t('inbox.title'), href: '/support' },
  ];

  const header = (
    <View style={{ gap: spacing.xl, paddingTop: spacing.sm }}>
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <BrandLogo height={40} />
          <Row gap={10}>
            <HeaderIcon icon="chatbubble-ellipses-outline" label={t('inbox.title')} count={unread.data} onPress={() => router.push('/support')} />
            <HeaderIcon icon="notifications-outline" label={t('notifications.title')} onPress={() => router.push('/notifications')} />
          </Row>
        </Row>

        <Pressable
          onPress={() => router.push('/search')}
          style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="search"
        >
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <T muted style={{ flex: 1 }}>{t('home.searchPlaceholder')}</T>
          <Ionicons name="barcode-outline" size={22} color={colors.primary} />
        </Pressable>

        <Card onPress={() => router.push('/stores')}>
          <Row>
            <Ionicons name="location" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <T size="xs" muted>{t('home.store')}</T>
              <T weight="700" numberOfLines={1}>{selectedStore ? selectedStore.name : t('home.chooseStore')}</T>
              {selectedStore ? (
                <T size="xs" muted numberOfLines={1}>
                  {selectedStore.address_verified ? [selectedStore.commune, selectedStore.quartier].filter(Boolean).join(', ') : t('stores.addressToVerify')}
                </T>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Row>
        </Card>
      </View>

      <BannerCarousel />

      <View style={[styles.quickGrid, { paddingHorizontal: spacing.lg }]}>
        {quick.map((q) => (
          <Pressable key={q.href} onPress={() => router.push(q.href as never)} style={styles.quickItem} accessibilityRole="button">
            <View style={[styles.quickIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={q.icon} size={22} color={colors.primary} />
            </View>
            <T size="xs" style={{ textAlign: 'center' }} numberOfLines={2}>{q.label}</T>
          </Pressable>
        ))}
      </View>

      {categories.data && categories.data.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <View style={{ paddingHorizontal: spacing.lg }}>
            <SectionHeader title={t('tab.categories')} action={t('common.seeAll')} onAction={() => router.push('/(customer)/categories')} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            {categories.data.filter((c) => !c.parent_id).map((c) => (
              <Chip key={c.id} label={localized(c.name, language, c.slug)} onPress={() => router.push(`/category/${c.id}`)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.xl }}>
        <ProductRail title={t('home.bestOffers')} items={promo.data} />
        <ProductRail title={t('home.featured')} items={featured.data} />
        <ProductRail title={t('home.bestSellers')} items={best.data} />
        <ProductRail title={t('home.newArrivals')} items={fresh.data} />
        <ProductRail title={t('home.local')} items={local.data} />
        {!best.isLoading && !anyProducts ? (
          <EmptyState icon="storefront-outline" message={(stores.data?.length ?? 0) === 0 ? t('home.noStores') : t('home.noProducts')} />
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <ProductFeedList
        feed={{ kind: 'all', storeId: selectedStoreId }}
        header={header}
        title={t('home.allProducts')}
        subtitle={selectedStore ? selectedStore.name : t('home.allStores')}
        refreshing={stores.isRefetching}
        onRefresh={() => qc.invalidateQueries()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.lg, minHeight: 48 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  quickItem: { width: '33.33%', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  quickIcon: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});
