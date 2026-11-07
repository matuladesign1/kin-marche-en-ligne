import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { AppFooter } from '@/components/AppFooter';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { Avatar, FilterChip } from '@/components/kit';
import { PastryOrderRow } from '@/components/Pastry';
import { Button, EmptyState, Loading, Notice, Row, T, type IconName } from '@/components/ui';
import { useUnreadCount } from '@/hooks/data';
import { useChefOrders, useMyPastryChef } from '@/hooks/pastry';
import { PASTRY, isUrgent, profileChecklist } from '@/lib/pastry';
import { homeForRole } from '@/lib/roles';
import { radius, spacing } from '@/lib/theme';
import type { PastryOrder } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Espace pâtissier : bandeau chocolat et framboise, état du profil (certification), chiffres du jour,
// commandes à traiter par étape (nouvelles, prix envoyés, à préparer, prêtes, terminées).

type Tab = 'new' | 'quoted' | 'prep' | 'ready' | 'done';
const TAB_STATUSES: Record<Tab, PastryOrder['status'][]> = {
  new: ['submitted'],
  quoted: ['quoted', 'accepted'],
  prep: ['paid', 'in_preparation'],
  ready: ['ready', 'delivering'],
  done: ['delivered', 'rejected', 'cancelled'],
};

function HeroBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="pstBg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={PASTRY.choco} />
          <Stop offset="1" stopColor={PASTRY.chocoDeep} />
        </LinearGradient>
        <RadialGradient id="pstGlow" cx="90%" cy="6%" r="62%">
          <Stop offset="0" stopColor={PASTRY.raspberry} stopOpacity={0.4} />
          <Stop offset="1" stopColor={PASTRY.choco} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#pstBg)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#pstGlow)" />
      <Circle cx="6%" cy="98%" r="78" fill={PASTRY.caramel} opacity={0.12} />
      <Circle cx="30%" cy="104%" r="34" fill={PASTRY.vanilla} opacity={0.06} />
    </Svg>
  );
}

function Kpi({ icon, tint, value, label }: { icon: IconName; tint: string; value: string; label: string }) {
  return (
    <View style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: `${tint}33` }]}><Ionicons name={icon} size={18} color={tint} /></View>
      <T size="lg" weight="800" color="#FFFFFF" numberOfLines={1}>{value}</T>
      <T size="xs" color={PASTRY.cocoaText} numberOfLines={1}>{label}</T>
    </View>
  );
}

export default function PastryHome() {
  const { t, colors } = useSettings();
  const { loading, profile, session, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const chef = useMyPastryChef();
  const c = chef.data;
  const orders = useChefOrders(c?.status === 'active' ? c.store_id : null);
  const unread = useUnreadCount();
  const [tab, setTab] = useState<Tab>('new');
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  const list = useMemo(() => orders.data ?? [], [orders.data]);
  const counts = useMemo(() => {
    const out = { new: 0, quoted: 0, prep: 0, ready: 0, done: 0 } as Record<Tab, number>;
    for (const o of list) for (const k of Object.keys(TAB_STATUSES) as Tab[]) if (TAB_STATUSES[k].includes(o.status)) out[k]++;
    return out;
  }, [list]);

  if (loading || chef.isLoading) return <Loading />;
  if (profile?.role !== 'pastry_chef') return <Redirect href={homeForRole(profile?.role)} />;

  const uid = session?.user.id;
  const firstName = (c?.display_name || profile?.full_name || '').trim().split(/\s+/)[0];
  const check = profileChecklist(c, profile?.phone);
  const shown = list
    .filter((o) => TAB_STATUSES[tab].includes(o.status))
    .sort((a, b) => {
      // Les plus urgentes d'abord pour les commandes à traiter ; les plus récentes d'abord pour l'historique.
      if (tab === 'done') return b.updated_at.localeCompare(a.updated_at);
      const ta = a.desired_at ? new Date(a.desired_at).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.desired_at ? new Date(b.desired_at).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb || a.created_at.localeCompare(b.created_at);
    });

  const statusCard = (() => {
    if (!c) return { icon: 'lock-closed' as IconName, tint: '#F59E0B', title: t('pastryChef.noAccessTitle'), text: t('pastryChef.noAccess') };
    if (c.status === 'suspended') return { icon: 'pause-circle' as IconName, tint: '#F87171', title: t('pastryChef.suspended'), text: t('pastryChef.suspendedText') };
    if (c.certified) return { icon: 'ribbon' as IconName, tint: PASTRY.pistachio, title: t('pastryProfile.certified'), text: t('pastryChef.certifiedText') };
    if (c.profile_completed_at) return { icon: 'hourglass' as IconName, tint: PASTRY.caramel, title: t('pastryChef.profileReview'), text: t('pastryChef.profileReviewText') };
    return { icon: 'id-card' as IconName, tint: PASTRY.raspberry, title: t('pastryChef.profileTodo', { done: check.done, total: check.total }), text: t('pastryChef.profileTodoText') };
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {focused ? <StatusBar style="light" /> : null}
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => { chef.refetch(); orders.refetch(); }} tintColor={PASTRY.raspberry} />}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
          <HeroBackground />
          <View style={styles.heroTop}>
            <View>
              <View style={[styles.avatarRing, { borderColor: c?.certified ? PASTRY.pistachio : 'rgba(255,255,255,0.25)' }]}>
                {profile?.avatar_url ? <Avatar uri={profile.avatar_url} name={profile.full_name} size={46} />
                  : <MaterialCommunityIcons name="chef-hat" size={26} color="#FFFFFF" />}
              </View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T size="xs" weight="700" color={PASTRY.caramel}>{t('pastryChef.space').toUpperCase()}</T>
              <View style={styles.nameRow}>
                <T size="xl" weight="800" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {firstName ? t('pastryChef.hello', { name: firstName }) : t('pastryChef.space')}
                </T>
                {c?.certified ? <CertifiedBadge size={20} label={t('pastryProfile.certified')} /> : null}
              </View>
              {c?.stores?.name ? (
                <Row gap={4}>
                  <Ionicons name="storefront-outline" size={13} color={PASTRY.cocoaText} />
                  <T size="xs" color={PASTRY.cocoaText} numberOfLines={1}>{c.stores.name}</T>
                </Row>
              ) : null}
            </View>
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('notifications.title')} style={styles.iconBtn}>
              <Ionicons name="notifications-outline" size={21} color="#FFFFFF" />
              {(unread.data?.notifications ?? 0) > 0 ? <View style={[styles.dot, { backgroundColor: PASTRY.raspberry }]} /> : null}
            </Pressable>
          </View>

          <Pressable onPress={() => c && router.push('/pastry/profile')} disabled={!c} accessibilityRole="button"
            style={[styles.statusCard, { borderColor: `${statusCard.tint}88` }]}>
            <View style={[styles.statusIcon, { backgroundColor: `${statusCard.tint}2E` }]}>
              <Ionicons name={statusCard.icon} size={20} color={statusCard.tint} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="800" color="#FFFFFF">{statusCard.title}</T>
              <T size="xs" color={PASTRY.cocoaText} style={{ lineHeight: 17 }}>{statusCard.text}</T>
              {c && !c.profile_completed_at ? (
                <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.round((check.done / check.total) * 100)}%` }]} /></View>
              ) : null}
            </View>
            {c ? <Ionicons name="chevron-forward" size={18} color="#FFFFFF" /> : null}
          </Pressable>

          <View style={styles.kpis}>
            <Kpi icon="sparkles" tint={PASTRY.raspberry} value={String(counts.new)} label={t('pastryChef.kpiNew')} />
            <Kpi icon="flame" tint={PASTRY.caramel} value={String(counts.prep)} label={t('pastryChef.kpiPrep')} />
            <Kpi icon="checkmark-done" tint={PASTRY.pistachio} value={String(c?.orders_done ?? 0)} label={t('pastryChef.kpiDone')} />
          </View>
        </View>

        <View style={styles.body}>
          {c?.status === 'active' ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {(Object.keys(TAB_STATUSES) as Tab[]).map((k) => (
                  <FilterChip key={k} active={tab === k} onPress={() => setTab(k)}
                    label={`${t(`pastryChef.tab.${k}` as 'pastryChef.tab.new')}${counts[k] ? ` (${counts[k]})` : ''}`} />
                ))}
              </ScrollView>
              {orders.isLoading ? <Loading /> : null}
              {!orders.isLoading && shown.length === 0 ? <EmptyState icon="cafe-outline" message={t('pastryChef.empty')} /> : null}
              {shown.map((o) => {
                const urgent = isUrgent(o);
                const taken = !!o.chef_id && o.chef_id !== uid;
                return (
                  <PastryOrderRow key={o.id} order={o} highlight={urgent ? PASTRY.raspberry : undefined}
                    subtitle={`${o.request_number ?? ''} · ${(o.full_name || '').split(/\s+/)[0]}`}
                    onPress={() => router.push(`/pastry/order/${o.id}`)}
                    right={urgent ? (
                      <View style={[styles.flag, { backgroundColor: PASTRY.raspberry }]}><T size="xs" weight="800" color="#FFFFFF">{t('pastryChef.urgent')}</T></View>
                    ) : taken ? <T size="xs" muted>{t('pastryChef.takenByOther')}</T> : null}
                  />
                );
              })}
            </>
          ) : c ? <Notice tone="warning" text={t('pastryChef.suspendedText')} /> : <Notice text={t('pastryChef.noAccess')} />}

          <View style={styles.grid}>
            <Pressable onPress={() => c && router.push('/pastry/profile')} disabled={!c} accessibilityRole="button"
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.88 : 1 }]}>
              <View style={[styles.tileIcon, { backgroundColor: `${PASTRY.raspberry}1F` }]}><Ionicons name="id-card-outline" size={22} color={PASTRY.raspberry} /></View>
              <T weight="800">{t('pastryChef.myProfile')}</T>
              <T size="xs" muted numberOfLines={2}>{t('pastryChef.myProfileHint')}</T>
            </Pressable>
            <Pressable onPress={() => router.push('/support')} accessibilityRole="button"
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.88 : 1 }]}>
              <View style={[styles.tileIcon, { backgroundColor: `${PASTRY.caramel}26` }]}><Ionicons name="chatbubbles-outline" size={22} color="#B7701E" /></View>
              {(unread.data?.messages ?? 0) > 0 ? <View style={[styles.badge, { backgroundColor: PASTRY.raspberry }]}><T size="xs" weight="800" color="#FFFFFF">{unread.data?.messages}</T></View> : null}
              <T weight="800">{t('inbox.title')}</T>
              <T size="xs" muted numberOfLines={2}>{t('pastryChef.messagesHint')}</T>
            </Pressable>
          </View>

          <Button title={t('auth.signOut')} variant="ghost" icon="log-out-outline" onPress={() => signOut().then(() => router.replace('/'))} />
          <AppFooter />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  dot: { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: PASTRY.choco },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, backgroundColor: 'rgba(255,255,255,0.06)' },
  statusIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  progress: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden', marginTop: 4 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: PASTRY.raspberry },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, borderRadius: radius.md, padding: spacing.md, gap: 4, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  kpiIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  body: { padding: spacing.lg, gap: spacing.md },
  flag: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  tile: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: 4, minHeight: 118 },
  tileIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  badge: { position: 'absolute', top: spacing.md, right: spacing.md, minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
});
