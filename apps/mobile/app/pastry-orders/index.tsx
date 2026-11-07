import { Redirect, router, Stack } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PastryOrderRow } from '@/components/Pastry';
import { Button, EmptyState, ErrorState, Loading, T } from '@/components/ui';
import { useMyPastryOrders } from '@/hooks/pastry';
import { spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Mes commandes pâtisserie : en cours d'abord, puis l'historique.
export default function MyPastryOrders() {
  const { t, colors } = useSettings();
  const { session, loading } = useAuth();
  const list = useMyPastryOrders();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorState message={t('common.error')} onRetry={list.refetch} />;
  const all = list.data ?? [];
  const current = all.filter((o) => !['delivered', 'rejected', 'cancelled'].includes(o.status));
  const past = all.filter((o) => ['delivered', 'rejected', 'cancelled'].includes(o.status));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['left', 'right']}>
      <Stack.Screen options={{ title: t('pastry.myOrders') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} />}>
        <Button title={t('pastry.newOrder')} icon="add-circle-outline" onPress={() => router.push('/cake')} />
        {all.length === 0 ? <EmptyState icon="gift-outline" message={t('pastry.empty')} /> : null}
        {current.length ? <T size="lg" weight="800">{t('pastry.current')}</T> : null}
        {current.map((o) => <PastryOrderRow key={o.id} order={o} onPress={() => router.push(`/pastry-orders/${o.id}`)} />)}
        {past.length ? <View style={{ height: spacing.sm }} /> : null}
        {past.length ? <T size="lg" weight="800">{t('pastry.history')}</T> : null}
        {past.map((o) => <PastryOrderRow key={o.id} order={o} onPress={() => router.push(`/pastry-orders/${o.id}`)} />)}
      </ScrollView>
    </SafeAreaView>
  );
}
