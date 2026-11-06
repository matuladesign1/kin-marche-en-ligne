import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useDeleteNotifications, useMarkNotificationsRead, useNotifications, useUnreadCount } from '@/hooks/data';
import { timeAgo } from '@/lib/format';
import { hasAppLink } from '@/lib/links';
import { openNotification } from '@/lib/notify';
import { TO_RECEIVE } from '@/lib/orders';
import { radius, spacing } from '@/lib/theme';
import type { AppNotification, OrderStatus } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';
import { BannerCarousel, MESSAGES_BANNER_RATIO } from './BannerCarousel';
import { ChatAvatar } from './ChatAvatar';
import { CountBadge, FilterChip, WheelIcon } from './kit';
import { EmptyState, Loading, T, type IconName } from './ui';

type Filter = 'all' | 'orders' | 'rewards' | 'account';

function categoryOf(kind: string): Exclude<Filter, 'all'> {
  if (kind === 'order_status' || kind === 'new_order' || kind === 'no_driver') return 'orders';
  if (kind === 'loyalty' || kind === 'wheel') return 'rewards';
  return 'account';
}

function KindIcon({ n }: { n: AppNotification }) {
  const { colors } = useSettings();
  const status = typeof n.data?.status === 'string' ? (n.data.status as OrderStatus) : null;
  let icon: IconName = 'notifications';
  let color = colors.textMuted;
  let custom: ReactNode = null;
  if (n.kind === 'order_status') {
    if (status && ['delivered', 'completed'].includes(status)) { icon = 'checkmark-done'; color = colors.success; }
    else if (status && ['cancelled', 'failed', 'refunded'].includes(status)) { icon = 'close-circle'; color = colors.danger; }
    else if (status && TO_RECEIVE.includes(status)) { icon = 'bicycle'; color = colors.accent; }
    else { icon = 'receipt'; color = colors.accent; }
  } else if (n.kind === 'wheel') custom = <WheelIcon size={24} />;
  else if (n.kind === 'loyalty') { icon = 'card'; color = '#E8A317'; }
  else if (n.kind === 'welcome') { icon = 'sparkles'; color = colors.primary; }
  else if (n.kind === 'message' || n.kind === 'ticket') { icon = 'chatbubbles'; color = colors.accent2; }
  else if (n.kind === 'promo' || n.kind === 'marketing') { icon = 'pricetags'; color = colors.primary; }
  return (
    <View style={[styles.kindIcon, { backgroundColor: colors.surfaceAlt }]}>
      {custom ?? <Ionicons name={icon} size={22} color={color} />}
    </View>
  );
}

/** Promotion de l'administration : photo en grand (format 2:1 du push), titre, texte et « Voir l'offre ». */
function PromoCard({ n, onOpen, onDelete }: { n: AppNotification; onOpen: () => void; onDelete: () => void }) {
  const { t, language, colors } = useSettings();
  const d = n.data ?? {};
  const image = typeof d.image_url === 'string' ? d.image_url : null;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button"
      style={({ pressed }) => [styles.promo, { backgroundColor: colors.surface, opacity: pressed ? 0.92 : 1 }]}>
      <View style={styles.promoHead}>
        <Ionicons name="pricetags" size={15} color={colors.primary} />
        <T size="xs" weight="800" color={colors.primary} style={{ flex: 1 }}>{t('promo.label').toUpperCase()}</T>
        <T size="xs" muted>{timeAgo(n.created_at, language, t)}</T>
        {!n.read_at ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
        <Pressable onPress={onDelete} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('inbox.delete')}
          style={({ pressed }) => [styles.trash, { opacity: pressed ? 0.5 : 1 }]}>
          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
      {image ? (
        <Image source={{ uri: image }} style={[styles.promoImage, { backgroundColor: colors.surfaceAlt }]} contentFit="cover" transition={200}
          accessibilityLabel={n.title} />
      ) : null}
      <View style={{ gap: 4 }}>
        <T weight={n.read_at ? '700' : '800'}>{n.title}</T>
        {n.body ? <T size="sm" muted numberOfLines={4}>{n.body}</T> : null}
      </View>
      {hasAppLink(d.link_type, d.link_value) ? (
        <View style={[styles.promoCta, { backgroundColor: colors.primary }]}>
          <T size="sm" weight="800" color="#FFFFFF">{t('promo.cta')}</T>
          <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Boîte de réception : assistance + notifications (onglet « Messages »). */
export function Inbox() {
  const { t, language, colors } = useSettings();
  const { session } = useAuth();
  const q = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkNotificationsRead();
  const del = useDeleteNotifications();
  const [filter, setFilter] = useState<Filter>('all');

  const list = useMemo(() => (q.data ?? []).filter((n) => filter === 'all' || categoryOf(n.kind) === filter), [q.data, filter]);

  // Publicité produits en haut de la page (1667 × 238 px), gérée par l'administrateur général.
  const ad = <BannerCarousel placement="messages" ratio={MESSAGES_BANNER_RATIO} inset={spacing.md} captions={false} />;

  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: spacing.md }}>
        {ad}
        <EmptyState icon="chatbox-ellipses-outline" message={t('inbox.signIn')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />
      </View>
    );
  }

  const deleteShown = () => {
    const ids = list.map((n) => n.id);
    if (!ids.length) return;
    Alert.alert(t('inbox.deleteAll'), t('inbox.deleteAllConfirm', { n: ids.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('inbox.delete'), style: 'destructive', onPress: () => del.mutate(ids) },
    ]);
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('inbox.filter.all') },
    { key: 'orders', label: t('inbox.filter.orders') },
    { key: 'rewards', label: t('inbox.filter.rewards') },
    { key: 'account', label: t('inbox.filter.account') },
  ];

  const header = (
    <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
      {ad}
      <Pressable onPress={() => router.push('/support')} accessibilityRole="button"
        style={({ pressed }) => [styles.support, { backgroundColor: colors.surface, opacity: pressed ? 0.9 : 1 }]}>
        <ChatAvatar size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="800">{t('inbox.supportTitle')}</T>
          <T size="sm" muted numberOfLines={1}>{t('inbox.supportText')}</T>
        </View>
        <CountBadge count={unread.data?.messages ?? 0} />
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}>
        {filters.map((f) => <FilterChip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />)}
      </ScrollView>

      <View style={styles.listHead}>
        <T size="lg" weight="800">{t('notifications.title')}</T>
        <View style={styles.headActions}>
          {(unread.data?.notifications ?? 0) > 0 ? (
            <Pressable onPress={() => markRead.mutate(undefined)} hitSlop={8} accessibilityRole="button">
              <T size="sm" weight="700" color={colors.primary}>{t('inbox.markAllRead')}</T>
            </Pressable>
          ) : null}
          {list.length > 0 ? (
            <Pressable onPress={deleteShown} hitSlop={8} accessibilityRole="button">
              <T size="sm" weight="700" color={colors.danger}>{t('inbox.deleteAll')}</T>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      data={list}
      keyExtractor={(n) => n.id}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      ItemSeparatorComponent={({ leadingItem, trailingItem }: { leadingItem?: AppNotification; trailingItem?: AppNotification }) =>
        leadingItem?.kind === 'promo' || trailingItem?.kind === 'promo' ? null : <View style={[styles.sep, { backgroundColor: colors.border }]} />}
      renderItem={({ item: n }) => n.kind === 'promo' ? (
        <PromoCard n={n} onOpen={() => { if (!n.read_at) markRead.mutate([n.id]); openNotification(n); }} onDelete={() => del.mutate([n.id])} />
      ) : (
        <Pressable
          onPress={() => { if (!n.read_at) markRead.mutate([n.id]); openNotification(n); }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.surfaceAlt : colors.surface }]}
        >
          <KindIcon n={n} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.itemTop}>
              <T weight={n.read_at ? '600' : '800'} numberOfLines={1} style={{ flex: 1 }}>{n.title}</T>
              <T size="xs" muted>{timeAgo(n.created_at, language, t)}</T>
            </View>
            {n.body ? <T size="sm" muted numberOfLines={2}>{n.body}</T> : null}
          </View>
          {!n.read_at ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
          <Pressable onPress={() => del.mutate([n.id])} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('inbox.delete')}
            style={({ pressed }) => [styles.trash, { opacity: pressed ? 0.5 : 1 }]}>
            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </Pressable>
      )}
      ListEmptyComponent={q.isLoading ? <Loading /> : <EmptyState icon="notifications-off-outline" message={t('notifications.empty')} />}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); unread.refetch(); }} tintColor={colors.primary} colors={[colors.primary]} />}
    />
  );
}

const styles = StyleSheet.create({
  support: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.md, borderRadius: radius.md, padding: spacing.md },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  trash: { padding: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kindIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
  promo: { marginHorizontal: spacing.md, marginVertical: spacing.sm, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  promoHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  promoImage: { width: '100%', aspectRatio: 2, borderRadius: radius.md },
  promoCta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 9 },
});
