import { router } from 'expo-router';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, EmptyState, ErrorState, Loading, Row, Screen, T } from '@/components/ui';
import { qk, useOrders } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function Orders() {
  const { t, money, language, colors } = useSettings();
  const { session } = useAuth();
  const orders = useOrders();
  const qc = useQueryClient();

  // Mise à jour en temps réel des statuts (la RLS filtre les commandes visibles).
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel('my-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${session.user.id}` },
        () => qc.invalidateQueries({ queryKey: qk.orders }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, qc]);

  if (!session) return <EmptyState icon="person-circle-outline" message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;
  if (orders.isLoading) return <Loading />;
  if (orders.error) return <ErrorState message={errorMessage(orders.error, t)} onRetry={orders.refetch} />;
  if (!orders.data?.length) return <EmptyState icon="receipt-outline" message={t('orders.empty')} />;

  return (
    <Screen>
      {orders.data.map((o) => (
        <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="700">{o.order_number}</T>
            <T weight="700">{money(o.total_usd)}</T>
          </Row>
          <T size="sm" muted>{o.stores?.name ?? ''} · {formatDate(o.created_at, language)}</T>
          <Row style={{ justifyContent: 'space-between' }}>
            <T size="sm" color={o.status === 'cancelled' ? colors.danger : colors.primary} weight="600">{t(`status.${o.status}`)}</T>
            <T size="xs" muted>{t(`payStatus.${o.payment_status}`)}</T>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
