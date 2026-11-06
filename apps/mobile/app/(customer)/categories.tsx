import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientBg } from '@/components/kit';
import { ProductFeedList } from '@/components/ProductFeedList';
import { ErrorState, Loading, T, type IconName } from '@/components/ui';
import { useCategories } from '@/hooks/data';
import type { FeedFilter } from '@/hooks/feed';
import { localized, type TranslationKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import type { Category } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

// Page Catégories : colonne des catégories à gauche (texte seul), et à droite la bannière de la catégorie,
// ses raccourcis en cercles (sous-catégories et sélections) puis « Laissez-vous inspirer » :
// tous les produits de la catégorie choisie, chargés au fil du défilement.

const RAIL = 100;
const FOR_YOU = 'for-you';
/** Couleurs du logo Kin Marché (rouge, bleu, turquoise) et couleurs d'accompagnement, une par catégorie. */
const HUES = ['#DE3530', '#0097FC', '#01789D', '#E8A317', '#13A35F', '#7B3FE4'];

const COLLECTIONS: { key: FeedFilter; icon: IconName; label: TranslationKey; badge?: 'hot' | 'up' }[] = [
  { key: 'all', icon: 'apps', label: 'cat.col.all' },
  { key: 'promo', icon: 'pricetags', label: 'cat.col.promo', badge: 'hot' },
  { key: 'best', icon: 'trending-up', label: 'cat.col.best', badge: 'up' },
  { key: 'new', icon: 'sparkles', label: 'cat.col.new' },
  { key: 'featured', icon: 'star', label: 'cat.col.featured' },
  { key: 'local', icon: 'leaf', label: 'cat.col.local' },
];

/** Couleur #RRGGBB avec transparence (fond des cercles). */
function tint(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

/** Couleur #RRGGBB assombrie (bas du dégradé des bannières). */
function shade(hex: string, factor: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * factor).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const catIcon = (c: Category) => (c.icon || 'pricetag') as IconName;

export default function Categories() {
  const { t, language, colors, selectedStoreId } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cats = useCategories();
  const [selected, setSelected] = useState<string>(FOR_YOU);
  const [filter, setFilter] = useState<FeedFilter>('all');

  const top = useMemo(() => (cats.data ?? []).filter((c) => !c.parent_id), [cats.data]);
  const current = top.find((c) => c.id === selected) ?? null;
  const children = useMemo(() => (cats.data ?? []).filter((c) => c.parent_id === selected), [cats.data, selected]);
  const categoryIds = useMemo(() => (current ? [current.id, ...children.map((c) => c.id)] : null), [current, children]);
  const hueOf = (c: Category) => HUES[Math.max(0, top.indexOf(c)) % HUES.length];
  const hue = current ? hueOf(current) : colors.primary;
  const name = current ? localized(current.name, language, current.slug) : '';
  const paneWidth = width - RAIL;

  // Nombre d'offres de la catégorie : sans produit, « Laissez-vous inspirer » propose tout le catalogue.
  const count = useQuery({
    queryKey: ['category-offers', categoryIds, selectedStoreId],
    enabled: !!categoryIds,
    queryFn: async () => {
      let q = supabase.from('catalog_items').select('inventory_id', { count: 'exact', head: true }).in('category_id', categoryIds ?? []);
      if (selectedStoreId) q = q.eq('store_id', selectedStoreId);
      const { count: n, error } = await q;
      if (error) throw error;
      return n ?? 0;
    },
  });
  const empty = !!categoryIds && count.data === 0;

  const select = (id: string) => {
    setSelected(id);
    setFilter('all');
  };

  const rail = [{ id: FOR_YOU, label: t('cat.forYou') }, ...top.map((c) => ({ id: c.id, label: localized(c.name, language, c.slug) }))];

  const header = (
    <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
      <Banner
        hue={hue}
        title={current ? name : 'Kin Marché'}
        icon={current ? catIcon(current) : 'storefront'}
        image={current?.image_url ?? null}
        lines={[
          current && count.data ? t('cat.offers', { n: count.data }) : t('cat.price'),
          t('cat.fast'),
        ]}
      />
      <View style={{ paddingHorizontal: spacing.sm, gap: spacing.sm }}>
        <T size="lg" weight="800">{current ? t('cat.explore') : t('cat.recommended')}</T>
        <View style={styles.circles}>
          {current ? (
            <>
              {children.map((c) => (
                <Circle key={c.id} label={localized(c.name, language, c.slug)} icon={catIcon(c)} image={c.image_url} hue={hue}
                  onPress={() => router.push(`/category/${c.id}`)} />
              ))}
              {COLLECTIONS.map((col) => (
                <Circle key={col.key} label={t(col.label)} icon={col.icon} hue={hue} badge={col.badge}
                  active={filter === col.key} onPress={() => setFilter(col.key)} />
              ))}
            </>
          ) : (
            <>
              <Circle label={t('cat.photoSearch')} icon="camera" hue={colors.primary} badge="up"
                onPress={() => router.push('/search?mode=photo')} />
              {top.map((c) => (
                <Circle key={c.id} label={localized(c.name, language, c.slug)} icon={catIcon(c)} image={c.image_url} hue={hueOf(c)}
                  onPress={() => select(c.id)} />
              ))}
            </>
          )}
        </View>
      </View>
      <View style={[styles.sep, { backgroundColor: colors.border }]} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <T size="xxl" weight="800">{t('tab.categories')}</T>
        <Pressable onPress={() => router.push('/search')} accessibilityRole="search"
          style={[styles.search, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <T muted numberOfLines={1} style={{ flex: 1 }}>{t('home.searchPlaceholder')}</T>
          <Pressable onPress={() => router.push('/search?mode=photo')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('cat.photoSearch')}
            style={[styles.camBtn, { backgroundColor: colors.primary }]}>
            <Ionicons name="camera" size={16} color={colors.onPrimary} />
          </Pressable>
        </Pressable>
      </View>

      <View style={styles.body}>
        <ScrollView style={[styles.rail, { backgroundColor: colors.surfaceAlt }]} showsVerticalScrollIndicator={false}>
          {rail.map((it) => {
            const active = it.id === selected;
            return (
              <Pressable key={it.id} onPress={() => select(it.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}
                style={[styles.railItem, active && { backgroundColor: colors.surface }]}>
                {active ? <View style={[styles.railBar, { backgroundColor: colors.primary }]} /> : null}
                <T size="sm" weight={active ? '800' : '500'} color={active ? colors.text : colors.textMuted}>{it.label}</T>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flex: 1 }}>
          {cats.isLoading ? <Loading /> : cats.error ? <ErrorState message={t('common.error')} onRetry={cats.refetch} /> : (
            <ProductFeedList
              key={selected}
              feed={{ kind: 'all', storeId: selectedStoreId, filter, categoryIds: empty ? null : categoryIds }}
              header={header}
              title={t('cat.inspire')}
              subtitle={!current ? t('cat.inspireAll') : empty ? t('cat.empty', { cat: name }) : t('cat.inspireSub', { cat: name })}
              width={paneWidth}
              side={spacing.sm}
              background={colors.surface}
              endFooter={false}
              emptyMessage={t('home.noProducts')}
              refreshing={cats.isRefetching}
              onRefresh={() => { cats.refetch(); count.refetch(); }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

/** Bannière de la catégorie : dégradé à ses couleurs, promesses Kin Marché, icône ou photo de la catégorie. */
function Banner({ hue, title, icon, image, lines }: { hue: string; title: string; icon: IconName; image: string | null; lines: string[] }) {
  return (
    <View style={[styles.banner, { backgroundColor: hue }]}>
      <GradientBg from={hue} to={shade(hue, 0.72)} />
      <View style={[styles.decor, { width: 120, height: 120, right: -30, top: -40 }]} />
      <View style={[styles.decor, { width: 70, height: 70, right: 60, bottom: -35 }]} />
      <View style={{ flex: 1, gap: 4 }}>
        <T size="lg" weight="800" color="#FFFFFF" numberOfLines={2}>{title}</T>
        {lines.map((l) => (
          <View key={l} style={styles.bannerLine}>
            <Ionicons name="checkmark-circle" size={14} color="#FFFFFF" />
            <T size="xs" weight="600" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1 }}>{l}</T>
          </View>
        ))}
      </View>
      <View style={styles.bannerArt}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          : <Ionicons name={icon} size={38} color="#FFFFFF" />}
      </View>
    </View>
  );
}

/** Raccourci rond : icône (ou photo) et libellé, avec pastille « promo » ou « tendance ». */
const Circle = memo(function Circle({ label, icon, image, hue, active, badge, onPress }: {
  label: string; icon: IconName; image?: string | null; hue: string; active?: boolean; badge?: 'hot' | 'up'; onPress: () => void;
}) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.75 : 1 }]}>
      <View style={[styles.circle, { backgroundColor: tint(hue, 0.12), borderColor: active ? hue : 'transparent' }]}>
        {image ? <Image source={{ uri: image }} style={styles.circleImg} contentFit="cover" cachePolicy="memory-disk" />
          : <Ionicons name={icon} size={28} color={hue} />}
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            <Ionicons name={badge === 'hot' ? 'flame' : 'arrow-up'} size={11} color={badge === 'hot' ? '#DE3530' : '#0097FC'} />
          </View>
        ) : null}
      </View>
      <T size="xs" weight={active ? '800' : '500'} color={active ? hue : colors.text} numberOfLines={2} style={{ textAlign: 'center' }}>{label}</T>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  top: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingLeft: spacing.md, paddingRight: 5, height: 42 },
  camBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, flexDirection: 'row' },
  rail: { width: RAIL, flexGrow: 0 },
  railItem: { minHeight: 62, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  railBar: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  banner: { marginHorizontal: spacing.sm, borderRadius: radius.lg, overflow: 'hidden', minHeight: 104, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  decor: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  bannerLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bannerArt: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  circles: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  cell: { width: '33.333%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  circle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  circleImg: { width: 60, height: 60, borderRadius: 30 },
  badge: { position: 'absolute', top: -2, right: -2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  sep: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.sm, marginTop: spacing.xs },
});
