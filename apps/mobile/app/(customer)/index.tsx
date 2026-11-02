import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrandLogo } from '@/components/BrandHeader';
import { ProductRail } from '@/components/product';
import { Card, Chip, EmptyState, Row, SectionHeader, T, type IconName } from '@/components/ui';
import { useCategories, useHomeSection, useStores } from '@/hooks/data';
import { localized } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

export default function Home() {
  const { colors, t, language, selectedStoreId, setSelectedStoreId } = useSettings();
  const qc = useQueryClient();
  const stores = useStores();
  const categories = useCategories();
  const best = useHomeSection('best', selectedStoreId);
  const fresh = useHomeSection('new', selectedStoreId);
  const promo = useHomeSection('promo', selectedStoreId);
  const featured = useHomeSection('featured', selectedStoreId);
  const local = useHomeSection('local', selectedStoreId);
  const banners = useQuery({
    queryKey: ['banners'],
    queryFn: async () => (await supabase.from('banners').select('id, title, image_url, link_type, link_value').eq('is_active', true).order('sort_order')).data ?? [],
  });
  const partners = useQuery({
    queryKey: ['partners'],
    queryFn: async () => (await supabase.from('partners').select('id, name, logo_url').eq('is_active', true).order('sort_order')).data ?? [],
  });

  const selectedStore = stores.data?.find((s) => s.id === selectedStoreId);
  useEffect(() => {
    // Magasin supprimé ou désactivé : on revient à « tous les magasins ».
    if (selectedStoreId && stores.data && !selectedStore) setSelectedStoreId(null);
  }, [selectedStoreId, stores.data, selectedStore, setSelectedStoreId]);

  const refreshing = best.isRefetching || stores.isRefetching;
  const anyProducts = [best, fresh, promo, featured, local].some((q) => (q.data?.length ?? 0) > 0);
  const loadingProducts = best.isLoading;

  const quick: { icon: IconName; label: string; href: string }[] = [
    { icon: 'receipt-outline', label: t('home.quickOrders'), href: '/(customer)/orders' },
    { icon: 'heart-outline', label: t('home.favorites'), href: '/favorites' },
    { icon: 'star-outline', label: t('home.loyalty'), href: '/loyalty' },
    { icon: 'pricetag-outline', label: t('home.coupons'), href: '/coupons' },
    { icon: 'gift-outline', label: t('home.cakes'), href: '/cake' },
    { icon: 'chatbubbles-outline', label: t('home.support'), href: '/support' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => qc.invalidateQueries()} tintColor={colors.primary} />}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <BrandLogo height={40} />
          <Pressable onPress={() => router.push('/notifications')} hitSlop={10} accessibilityLabel={t('notifications.title')}>
            <Ionicons name="notifications-outline" size={26} color={colors.text} />
          </Pressable>
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

        {banners.data && banners.data.length > 0 ? (
          <FlatList
            horizontal
            pagingEnabled
            data={banners.data}
            keyExtractor={(b) => b.id}
            showsHorizontalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
            renderItem={({ item }) => (
              <Image source={{ uri: item.image_url }} style={styles.banner} contentFit="cover" accessibilityLabel={item.title ?? ''} />
            )}
          />
        ) : null}

        <View style={styles.quickGrid}>
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
            <SectionHeader title={t('tab.categories')} action={t('common.seeAll')} onAction={() => router.push('/(customer)/categories')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {categories.data.filter((c) => !c.parent_id).map((c) => (
                <Chip key={c.id} label={localized(c.name, language, c.slug)} onPress={() => router.push(`/category/${c.id}`)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <ProductRail title={t('home.bestOffers')} items={promo.data} onSeeAll={() => router.push('/search?promo=1')} />
        <ProductRail title={t('home.featured')} items={featured.data} />
        <ProductRail title={t('home.bestSellers')} items={best.data} />
        <ProductRail title={t('home.newArrivals')} items={fresh.data} />
        <ProductRail title={t('home.local')} items={local.data} />

        {!loadingProducts && !anyProducts ? (
          <EmptyState icon="storefront-outline" message={(stores.data?.length ?? 0) === 0 ? t('home.noStores') : t('home.noProducts')} />
        ) : null}

        {partners.data && partners.data.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <SectionHeader title={t('home.partners')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              {partners.data.map((p) => (
                <Card key={p.id} style={{ width: 110, alignItems: 'center' }}>
                  {p.logo_url ? <Image source={{ uri: p.logo_url }} style={{ width: 80, height: 40 }} contentFit="contain" /> : null}
                  <T size="xs" numberOfLines={1}>{p.name}</T>
                </Card>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.lg, minHeight: 48 },
  banner: { width: 320, height: 140, borderRadius: radius.lg },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  quickItem: { width: '33.33%', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  quickIcon: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
