import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BANNER_RATIO, useBanners } from '@/components/BannerCarousel';
import { ProductFeedList } from '@/components/ProductFeedList';
import { ErrorState, Loading, T, type IconName } from '@/components/ui';
import { useCategories, useCategoryTeasers } from '@/hooks/data';
import { localized } from '@/lib/i18n';
import { openAppLink } from '@/lib/links';
import { supabase, unwrap } from '@/lib/supabase';
import { spacing } from '@/lib/theme';
import type { CatalogItem } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

// Page Catégories (même présentation que les grandes applications de commerce) :
// - à gauche, la liste des catégories (texte seul, la catégorie choisie sur fond blanc avec un trait) ;
// - à droite, les articles de la catégorie en cercles photo, « Voir plus », puis « Laissez-vous inspirer » :
//   tous les produits de la catégorie choisie, chargés au fil du défilement.
// « Pour vous » : bannière de l'accueil, puis les catégories en cercles photo (« Recommandations »).

const RAIL = 92;
const FOR_YOU = 'for-you';
/** Cercles montrés avant « Voir plus » (5 lignes de 3 avec « Voir plus »). */
const MAX_CIRCLES = 14;
const PANE_SIDE = 10;

export default function Categories() {
  const { t, language, colors, selectedStoreId } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cats = useCategories();
  const teasers = useCategoryTeasers(selectedStoreId);
  const banners = useBanners('home');
  const [selected, setSelected] = useState<string>(FOR_YOU);

  const top = useMemo(() => (cats.data ?? []).filter((c) => !c.parent_id), [cats.data]);
  const current = top.find((c) => c.id === selected) ?? null;
  const children = useMemo(() => (cats.data ?? []).filter((c) => c.parent_id === selected), [cats.data, selected]);
  const categoryIds = useMemo(() => (current ? [current.id, ...children.map((c) => c.id)] : null), [current, children]);
  const paneWidth = width - RAIL;

  // Articles de la catégorie (un par produit, les plus vendus d'abord) : les cercles photo.
  const articles = useQuery({
    queryKey: ['category-articles', categoryIds, selectedStoreId],
    enabled: !!categoryIds,
    queryFn: async () => {
      let q = supabase.from('catalog_items').select('*').in('category_id', categoryIds ?? [])
        .order('in_stock', { ascending: false }).order('sold_count', { ascending: false }).limit(80);
      if (selectedStoreId) q = q.eq('store_id', selectedStoreId);
      const rows = unwrap(await q) as CatalogItem[];
      const seen = new Set<string>();
      return rows.filter((r) => (seen.has(r.product_id) ? false : (seen.add(r.product_id), true)));
    },
  });
  const empty = !!categoryIds && articles.isFetched && (articles.data?.length ?? 0) === 0;
  const photoOf = (categoryId: string) => teasers.data?.find((x) => x.categoryId === categoryId)?.image ?? null;
  const banner = banners.data?.[0];

  const rail = [{ id: FOR_YOU, label: t('cat.forYou') }, ...top.map((c) => ({ id: c.id, label: localized(c.name, language, c.slug) }))];
  const items = (articles.data ?? []).slice(0, Math.max(0, MAX_CIRCLES - children.length));

  const header = (
    <View style={{ paddingTop: spacing.md }}>
      {current ? (
        <>
          <View style={styles.grid}>
            {children.map((c) => (
              <Circle key={c.id} label={localized(c.name, language, c.slug)} image={c.image_url ?? photoOf(c.id)} icon={c.icon}
                onPress={() => router.push(`/category/${c.id}`)} />
            ))}
            {items.map((it, i) => (
              <Circle key={it.product_id} label={localized(it.name_i18n, language, it.name)} image={it.image_url}
                badge={it.on_promo ? 'promo' : i < 3 && it.sold_count > 0 ? 'trend' : undefined}
                onPress={() => router.push(`/product/${it.inventory_id}`)} />
            ))}
            {!empty && articles.isFetched ? (
              <Circle label={t('cat.seeMore')} more onPress={() => router.push(`/category/${current.id}`)} />
            ) : null}
          </View>
          {empty ? <T size="sm" muted style={{ paddingHorizontal: PANE_SIDE, paddingBottom: spacing.md }}>{t('cat.emptyShort')}</T> : null}
          {articles.isLoading ? <Loading /> : null}
        </>
      ) : (
        <>
          {banner ? (
            <Pressable onPress={() => openAppLink(banner.link_type, banner.link_value)} accessibilityRole="button"
              style={[styles.banner, { width: paneWidth - PANE_SIDE * 2, height: (paneWidth - PANE_SIDE * 2) / BANNER_RATIO, backgroundColor: colors.surfaceAlt }]}>
              <Image source={{ uri: banner.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            </Pressable>
          ) : null}
          <Text style={[styles.section, { color: colors.text }]} maxFontSizeMultiplier={1.15}>{t('cat.recommended')}</Text>
          <View style={styles.grid}>
            <Circle label={t('cat.hot')} hot onPress={() => router.push('/collection/best')} />
            {top.map((c) => (
              <Circle key={c.id} label={localized(c.name, language, c.slug)} image={c.image_url ?? photoOf(c.id)} icon={c.icon}
                onPress={() => setSelected(c.id)} />
            ))}
          </View>
        </>
      )}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.top, { paddingTop: insets.top + 6, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.15}>{t('tab.categories')}</Text>
      </View>

      <View style={styles.body}>
        <ScrollView style={[styles.rail, { backgroundColor: colors.surfaceAlt }]} showsVerticalScrollIndicator={false}>
          {rail.map((it) => {
            const active = it.id === selected;
            return (
              <Pressable key={it.id} onPress={() => setSelected(it.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}
                style={[styles.railItem, active && { backgroundColor: colors.surface }]}>
                {active ? <View style={[styles.railBar, { backgroundColor: colors.text }]} /> : null}
                <Text maxFontSizeMultiplier={1.15}
                  style={[styles.railText, { color: colors.text, fontWeight: active ? '700' : '400' }]}>{it.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flex: 1 }}>
          {cats.isLoading ? <Loading /> : cats.error ? <ErrorState message={t('common.error')} onRetry={cats.refetch} /> : (
            <ProductFeedList
              key={selected}
              feed={{ kind: 'all', storeId: selectedStoreId, filter: 'all', categoryIds: empty ? null : categoryIds }}
              header={header}
              title={t('cat.inspire')}
              width={paneWidth}
              side={PANE_SIDE}
              background={colors.surface}
              endFooter={false}
              emptyMessage={t('home.noProducts')}
              refreshing={cats.isRefetching}
              onRefresh={() => { cats.refetch(); articles.refetch(); }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

/** Cercle photo (gris clair) et son libellé ; « Voir plus » et « Produits à succès » ont leur dessin. */
const Circle = memo(function Circle({ label, image, icon, badge, hot, more, onPress }: {
  label: string; image?: string | null; icon?: string | null; badge?: 'promo' | 'trend'; hot?: boolean; more?: boolean; onPress: () => void;
}) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.circle, { backgroundColor: colors.surfaceAlt }, hot && styles.hotRing]}>
        {hot ? (
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="caret-up" size={16} color="#FF5A00" style={{ marginBottom: -4 }} />
            <View style={styles.hotTag}><Text style={styles.hotText} maxFontSizeMultiplier={1}>HOT</Text></View>
          </View>
        ) : image ? (
          <Image source={{ uri: image }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" recyclingKey={image} />
        ) : more ? (
          <Ionicons name="grid-outline" size={26} color={colors.textMuted} />
        ) : (
          <Ionicons name={`${icon || 'pricetag'}-outline` as IconName} size={28} color={colors.textMuted} />
        )}
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            {badge === 'promo'
              ? <Ionicons name="flame" size={11} color="#FF3B30" />
              : <MaterialCommunityIcons name="arrow-top-right-thick" size={11} color="#1677FF" />}
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} maxFontSizeMultiplier={1.15} style={[styles.label, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  top: { paddingHorizontal: spacing.lg, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '800' },
  body: { flex: 1, flexDirection: 'row' },
  rail: { width: RAIL, flexGrow: 0 },
  railItem: { justifyContent: 'center', paddingLeft: 12, paddingRight: 8, paddingVertical: 15, minHeight: 50 },
  railBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  railText: { fontSize: 13, lineHeight: 17 },
  banner: { alignSelf: 'center', borderRadius: 8, overflow: 'hidden', marginBottom: spacing.md },
  section: { fontSize: 16, fontWeight: '800', paddingHorizontal: PANE_SIDE, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PANE_SIDE - 4, rowGap: 14 },
  cell: { width: '33.333%', alignItems: 'center', gap: 6, paddingHorizontal: 3 },
  circle: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 68, height: 68, borderRadius: 34 },
  hotRing: { borderWidth: 2.5, borderColor: '#FF5A00', backgroundColor: '#FFFFFF' },
  hotTag: { backgroundColor: '#FF5A00', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  hotText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  badge: { position: 'absolute', top: 0, right: 0, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  label: { fontSize: 12, lineHeight: 15, textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: PANE_SIDE, marginTop: spacing.lg },
});
