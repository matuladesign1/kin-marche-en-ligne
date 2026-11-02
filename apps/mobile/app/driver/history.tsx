import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { BasketLoader } from '@/components/BasketLoader';
import { EmptyState, Loading, Row, T } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const PAGE = 30;
interface Past {
  id: string; order_id: string; delivered_at: string | null; route_distance_km: number | null;
  orders: { order_number: string; delivery_fee_usd: number; delivery_address: Record<string, string>; stores: { name: string } | null } | null;
}

export default function DriverHistory() {
  const { t, money, colors, language } = useSettings();
  const { session } = useAuth();
  const q = useInfiniteQuery({
    queryKey: ['driver-history'],
    enabled: !!session,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => ((await supabase.from('delivery_assignments')
      .select('id, order_id, delivered_at, route_distance_km, orders(order_number, delivery_fee_usd, delivery_address, stores(name))')
      .eq('driver_id', session!.user.id).eq('status', 'completed')
      .order('delivered_at', { ascending: false, nullsFirst: false }).range(pageParam, pageParam + PAGE - 1)).data ?? []) as unknown as Past[],
    getNextPageParam: (last, all) => (last.length < PAGE ? undefined : all.length * PAGE),
  });
  const items = q.data?.pages.flat() ?? [];

  if (q.isLoading) return <Loading />;
  if (!items.length) return <EmptyState icon="time-outline" message={t('driver.noHistory')} />;
  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
      data={items}
      keyExtractor={(x) => x.id}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/driver/mission/${item.order_id}`)} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: `${colors.success}1F` }]}><Ionicons name="checkmark-done" size={20} color={colors.success} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T weight="800">{item.orders?.order_number}</T>
              <T weight="800" color={colors.success}>{money(item.orders?.delivery_fee_usd ?? 0)}</T>
            </Row>
            <T size="sm" numberOfLines={1}>{item.orders?.stores?.name} → {item.orders?.delivery_address?.commune}</T>
            <T size="xs" muted>{formatDate(item.delivered_at, language)}{item.route_distance_km ? ` · ${t('stores.km', { km: item.route_distance_km })}` : ''}</T>
          </View>
        </Pressable>
      )}
      onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }}
      ListFooterComponent={<View>{q.isFetchingNextPage ? <BasketLoader size="mini" showLabel={false} /> : null}{!q.hasNextPage ? <AppFooter /> : null}</View>}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
