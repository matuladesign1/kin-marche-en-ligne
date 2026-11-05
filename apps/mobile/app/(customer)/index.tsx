import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { BannerCarousel } from '@/components/BannerCarousel';
import { CountBadge, FilterChip, FlagCD, GradientBg, TopTabs, WheelIcon } from '@/components/kit';
import { ProductFeedList } from '@/components/ProductFeedList';
import { EmptyState, Row, T, type IconName } from '@/components/ui';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useCategories, useCategoryTeasers, useRecentItems, useStores, useWheel } from '@/hooks/data';
import type { FeedFilter } from '@/hooks/feed';
import { localized } from '@/lib/i18n';
import { radius, spacing } from '@/lib/theme';
import type { Store } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

type HomeTab = 'products' | 'promos' | 'stores' | 'local';

const FILTERS: { key: FeedFilter; icon: IconName; color: string }[] = [
  { key: 'all', icon: 'flame', color: '#FF6A00' },
  { key: 'promo', icon: 'pricetag', color: '#DE3530' },
  { key: 'best', icon: 'trophy', color: '#E8A317' },
  { key: 'new', icon: 'sparkles', color: '#0097FC' },
  { key: 'featured', icon: 'thumbs-up', color: '#7B3FE4' },
  { key: 'local', icon: 'leaf', color: '#13A35F' },
];

function SearchBar() {
  const { colors, t } = useSettings();
  return (
    <View style={[styles.search, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
      <Pressable
        onPress={() => router.push('/search?mode=photo')}
        style={[styles.photoPill, { backgroundColor: colors.primarySoft }]}
        accessibilityRole="button"
        accessibilityLabel={t('search.photo')}
      >
        <Ionicons name="camera-outline" size={20} color={colors.primary} />
        <T weight="700" color={colors.primary}>{t('home.photo')}</T>
      </Pressable>
      <Pressable style={styles.searchText} onPress={() => router.push('/search')} accessibilityRole="search" accessibilityLabel={t('home.searchPlaceholder')}>
        <T muted numberOfLines={1}>{t('home.searchPlaceholder')}</T>
      </Pressable>
      <Pressable onPress={() => router.push('/search?mode=voice')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('search.voice')}>
        <Ionicons name="mic-outline" size={24} color={colors.text} />
      </Pressable>
      <Pressable onPress={() => router.push('/search')} style={[styles.searchBtn, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={t('search.title')}>
        <Ionicons name="search" size={22} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

/** Raccourci blanc : icône + libellé sur deux lignes (comme « Explorer par catégories »). */
function Shortcut({ icon, label, onPress, badge }: { icon: ReactNode; label: string; onPress: () => void; badge?: number }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.shortcut, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.shortcutIcon}>
        {icon}
        <CountBadge count={badge ?? 0} style={{ position: 'absolute', top: -6, right: -10 }} />
      </View>
      <T size="sm" weight="600" numberOfLines={2} style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}

/** Vignette photo + prix (« Vus récemment », « Explorez … »). */
function Tile({ image, price, label, onPress }: { image: string | null; price?: string; label: string; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, opacity: pressed ? 0.88 : 1 }]}>
      <View style={[styles.tileImage, { backgroundColor: colors.surfaceAlt }]}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : <Ionicons name="image-outline" size={32} color={colors.textMuted} />}
        {price ? (
          <View style={[styles.pricePill, { backgroundColor: colors.surface }]}>
            <T size="sm" weight="800">{price}</T>
          </View>
        ) : null}
      </View>
      <T size="sm" weight="600" numberOfLines={2} style={{ textAlign: 'center' }}>{label}</T>
    </Pressable>
  );
}

function StoreCard({ store, selected, onChoose }: { store: Store; selected: boolean; onChoose: () => void }) {
  const { colors, t, money } = useSettings();
  const place = store.address_verified ? [store.commune, store.quartier].filter(Boolean).join(', ') : t('stores.addressToVerify');
  return (
    <Pressable onPress={onChoose} accessibilityRole="button" accessibilityState={{ selected }}
      style={[styles.storeCard, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : 'transparent' }]}>
      <View style={[styles.storeIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="storefront" size={24} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Row gap={6}>
          <T weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{store.name}</T>
          {store.address_verified ? <VerifiedBadge size={14} color={colors.accent} /> : null}
        </Row>
        <T size="xs" muted numberOfLines={1}>{place}</T>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <View style={[styles.openPill, { backgroundColor: store.is_open ? colors.success + '22' : colors.surfaceAlt }]}>
            <T size="xs" weight="700" color={store.is_open ? colors.success : colors.textMuted}>{store.is_open ? t('home.open') : t('home.closed')}</T>
          </View>
          {Number(store.rating) > 0 ? (
            <Row gap={2}>
              <Ionicons name="star" size={12} color="#E8A317" />
              <T size="xs" weight="700">{Number(store.rating).toFixed(1)}</T>
            </Row>
          ) : null}
          <T size="xs" muted>{t('home.deliveryFrom', { fee: money(store.delivery_fee_usd) })} · {t('home.prepTime', { min: store.avg_prep_minutes })}</T>
        </Row>
      </View>
      <Ionicons name={selected ? 'checkmark-circle' : 'chevron-forward'} size={selected ? 24 : 18} color={selected ? colors.primary : colors.textMuted} />
    </Pressable>
  );
}

export default function Home() {
  const { colors, t, language, money, selectedStoreId, setSelectedStoreId } = useSettings();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const stores = useStores();
  const categories = useCategories();
  const wheel = useWheel();
  const recent = useRecentItems(1);
  const teasers = useCategoryTeasers(selectedStoreId);
  const [tab, setTab] = useState<HomeTab>('products');
  const [filter, setFilter] = useState<FeedFilter>('all');

  const selectedStore = stores.data?.find((s) => s.id === selectedStoreId);
  useEffect(() => {
    // Magasin supprimé ou désactivé : on revient à « tous les magasins ».
    if (selectedStoreId && stores.data && !selectedStore) setSelectedStoreId(null);
  }, [selectedStoreId, stores.data, selectedStore, setSelectedStoreId]);

  const refresh = () => qc.invalidateQueries();
  const catName = (id: string) => {
    const c = categories.data?.find((x) => x.id === id);
    return c ? localized(c.name, language, c.slug) : '';
  };

  const tabs: { key: HomeTab; label: string }[] = [
    { key: 'products', label: t('home.tab.products') },
    { key: 'promos', label: t('home.tab.promos') },
    { key: 'stores', label: t('home.tab.stores') },
    { key: 'local', label: t('home.tab.local') },
  ];

  const top = (
    <View style={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing.md, gap: spacing.md }}>
      <GradientBg from={colors.primarySoft} to={colors.background} />
      <TopTabs tabs={tabs} value={tab} onChange={setTab} />
      <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
        <SearchBar />
        <Pressable onPress={() => router.push('/stores')} style={styles.storeLine} accessibilityRole="button" accessibilityHint={t('home.chooseStore')}>
          <Ionicons name="location-outline" size={16} color={colors.text} />
          <T size="sm" numberOfLines={1} style={{ flexShrink: 1 }}>
            {selectedStore ? t('home.shopAt', { store: selectedStore.name }) : t('home.allStoresShort')}
          </T>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );

  const wheelOn = !!wheel.data?.enabled && (wheel.data?.prizes.length ?? 0) > 0;
  const shortcuts: { key: string; label: string; icon: ReactNode; onPress: () => void; badge?: number }[] = [
    { key: 'cats', label: t('home.short.categories'), icon: <Ionicons name="grid" size={28} color="#FF6A00" />, onPress: () => router.push('/(customer)/categories') },
    ...(wheelOn ? [{ key: 'wheel', label: t('wheel.title'), icon: <WheelIcon size={30} />, onPress: () => router.push('/wheel'), badge: wheel.data?.spins_available ?? 0 }] : []),
    { key: 'loyalty', label: t('home.short.loyalty'), icon: <Ionicons name="card" size={28} color="#E8A317" />, onPress: () => router.push('/loyalty') },
    { key: 'top', label: t('home.short.top'), icon: <Ionicons name="trophy" size={28} color="#E8A317" />, onPress: () => router.push('/collection/best') },
    { key: 'coupons', label: t('home.short.coupons'), icon: <Ionicons name="pricetags" size={26} color={colors.primary} />, onPress: () => router.push('/coupons') },
    { key: 'cakes', label: t('home.cakes'), icon: <Ionicons name="gift" size={26} color="#7B3FE4" />, onPress: () => router.push('/cake') },
  ];

  const lastSeen = recent.items?.[0];
  const productExtras = (
    <View style={{ gap: spacing.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
        {shortcuts.map(({ key, ...s }) => <Shortcut key={key} {...s} />)}
      </ScrollView>

      {lastSeen || (teasers.data?.length ?? 0) > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {lastSeen ? (
            <Tile image={lastSeen.image_url} price={money(lastSeen.effective_price_usd)} label={t('home.recent')} onPress={() => router.push('/recent')} />
          ) : null}
          {(teasers.data ?? []).filter((x) => catName(x.categoryId)).map((x) => (
            <Tile key={x.categoryId} image={x.image} price={t('home.fromPrice', { price: money(x.fromPrice) })}
              label={t('home.explore', { name: catName(x.categoryId) })} onPress={() => router.push(`/category/${x.categoryId}`)} />
          ))}
        </ScrollView>
      ) : null}

      <BannerCarousel />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.hScroll, { paddingVertical: 2 }]}>
        {FILTERS.map((f) => (
          <FilterChip key={f.key} label={t(`home.filter.${f.key}`)} icon={f.icon} iconColor={f.color} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </ScrollView>
    </View>
  );

  const intro = (icon: ReactNode, title: string, text: string) => (
    <View style={[styles.intro, { backgroundColor: colors.surface }]}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="800">{title}</T>
        <T size="sm" muted>{text}</T>
      </View>
    </View>
  );

  const noCatalog = (stores.data?.length ?? 0) === 0 ? t('home.noStores') : t('home.noProducts');

  if (tab === 'stores') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <FlatList
          data={stores.data ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}
          ListHeaderComponent={
            <View style={{ gap: spacing.md }}>
              {top}
              <View style={{ paddingHorizontal: spacing.md }}>
                <Pressable onPress={() => { setSelectedStoreId(null); setTab('products'); }}
                  style={[styles.storeCard, { backgroundColor: colors.surface, borderColor: !selectedStoreId ? colors.primary : 'transparent' }]}>
                  <View style={[styles.storeIcon, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name="apps" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T weight="800">{t('home.allStores')}</T>
                    <T size="xs" muted>{t('home.allStoresHint')}</T>
                  </View>
                  {!selectedStoreId ? <Ionicons name="checkmark-circle" size={24} color={colors.primary} /> : null}
                </Pressable>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: spacing.md }}>
              <StoreCard store={item} selected={item.id === selectedStoreId} onChoose={() => { setSelectedStoreId(item.id); setTab('products'); }} />
            </View>
          )}
          ListEmptyComponent={!stores.isLoading ? <EmptyState icon="storefront-outline" message={t('home.noStores')} /> : null}
          ListFooterComponent={
            <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
              <Pressable onPress={() => router.push('/stores')} style={[styles.mapLink, { borderColor: colors.border }]} accessibilityRole="button">
                <Ionicons name="map-outline" size={18} color={colors.primary} />
                <T weight="700" color={colors.primary}>{t('home.storesMap')}</T>
              </Pressable>
              <AppFooter />
            </View>
          }
          refreshControl={<RefreshControl refreshing={stores.isRefetching} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
        />
      </View>
    );
  }

  const feedFilter: FeedFilter = tab === 'promos' ? 'promo' : tab === 'local' ? 'local' : filter;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ProductFeedList
        key={tab}
        feed={{ kind: 'all', storeId: selectedStoreId, filter: feedFilter }}
        header={
          <View style={{ gap: spacing.md }}>
            {top}
            {tab === 'products' ? productExtras : null}
            {tab === 'promos' ? (
              <View style={{ paddingHorizontal: spacing.md }}>
                {intro(<Ionicons name="pricetags" size={30} color={colors.primary} />, t('home.promosTitle'), t('home.promosText'))}
              </View>
            ) : null}
            {tab === 'local' ? (
              <View style={{ paddingHorizontal: spacing.md }}>
                {intro(<FlagCD width={36} />, t('home.localTitle'), t('home.localText'))}
              </View>
            ) : null}
          </View>
        }
        emptyMessage={tab === 'promos' ? t('home.noPromos') : tab === 'local' ? t('home.noLocal') : noCatalog}
        refreshing={stores.isRefetching}
        onRefresh={refresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 2, borderRadius: 14,
    paddingLeft: 5, paddingRight: 5, minHeight: 54,
  },
  photoPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 10, height: 42 },
  searchText: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  searchBtn: { width: 54, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  storeLine: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  hScroll: { gap: spacing.sm, paddingHorizontal: spacing.md },
  shortcut: { width: 168, minHeight: 70, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  shortcutIcon: { width: 36, alignItems: 'center' },
  tile: { width: 136, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm },
  tileImage: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  pricePill: { position: 'absolute', bottom: 6, alignSelf: 'center', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.lg },
  storeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.md, borderWidth: 2 },
  storeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  openPill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  mapLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, minHeight: 48 },
});
