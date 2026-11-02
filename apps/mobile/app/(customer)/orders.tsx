import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, EmptyState, ErrorState, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { qk, useOrders } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import type { Order } from '@/lib/types';
import { spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

type Tab = 'all' | 'toPay' | 'toShip' | 'toReceive' | 'refund' | 'toReview' | 'done';
const TABS: Tab[] = ['all', 'toPay', 'toShip', 'toReceive', 'refund', 'toReview', 'done'];

const TO_SHIP = ['payment_confirmed', 'sent_to_store', 'preparing', 'verified', 'packed', 'ready'];
const TO_RECEIVE = ['driver_assigned', 'driver_to_store', 'picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check', 'delivered'];

function inTab(o: Order, tab: Tab, toReview: Set<string>): boolean {
  switch (tab) {
    case 'all': return true;
    case 'toPay': return o.status === 'received' && ['pending', 'processing', 'failed'].includes(o.payment_status);
    case 'toShip': return TO_SHIP.includes(o.status);
    case 'toReceive': return TO_RECEIVE.includes(o.status);
    case 'refund': return o.status === 'refunded' || ['refunded', 'partially_refunded'].includes(o.payment_status);
    case 'toReview': return toReview.has(o.id);
    case 'done': return ['completed', 'cancelled', 'failed'].includes(o.status);
  }
}

export default function Orders() {
  const { t, money, language, colors } = useSettings();
  const { session } = useAuth();
  const orders = useOrders();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);

  const toReview = useQuery({
    queryKey: ['orders-to-review'],
    enabled: !!session,
    queryFn: async () => new Set(((await supabase.rpc('orders_awaiting_review')).data ?? []) as string[]),
  });
  const proofs = useQuery({
    queryKey: ['payment-proofs'],
    enabled: !!session,
    queryFn: async () => {
      const { data } = await supabase.from('payment_proofs').select('order_id, status, created_at').order('created_at', { ascending: false });
      const map = new Map<string, string>();
      for (const p of (data ?? []) as { order_id: string; status: string }[]) if (!map.has(p.order_id)) map.set(p.order_id, p.status);
      return map;
    },
  });

  // Mise à jour en temps réel des statuts (la RLS filtre les commandes visibles).
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel('my-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${session.user.id}` }, () => {
        qc.invalidateQueries({ queryKey: qk.orders });
        qc.invalidateQueries({ queryKey: ['orders-to-review'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, qc]);

  const reviewSet = toReview.data ?? new Set<string>();
  const counts = useMemo(() => {
    const c: Partial<Record<Tab, number>> = {};
    for (const tb of TABS) c[tb] = (orders.data ?? []).filter((o) => inTab(o, tb, reviewSet)).length;
    return c;
  }, [orders.data, reviewSet]);

  if (!session) return <EmptyState icon="person-circle-outline" message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;
  if (orders.isLoading) return <Loading />;
  if (orders.error) return <ErrorState message={errorMessage(orders.error, t)} onRetry={orders.refetch} />;

  const runLookup = async () => {
    setLookupError(null);
    if (!lookup.trim()) return;
    const { data } = await supabase.rpc('lookup_my_order', { p_order_number: lookup.trim() });
    const found = data as { id: string } | null;
    if (!found?.id) return setLookupError(t('orders.lookupNotFound'));
    setLookup('');
    router.push(`/order/${found.id}`);
  };

  const list = (orders.data ?? []).filter((o) => inTab(o, tab, reviewSet));

  return (
    <Screen>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {TABS.map((tb) => (
          <Chip key={tb} active={tab === tb} onPress={() => setTab(tb)}
            label={`${t(`orders.tab.${tb}` as TranslationKey)}${counts[tb] ? ` (${counts[tb]})` : ''}`} />
        ))}
      </ScrollView>

      <Row style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><Input value={lookup} onChangeText={setLookup} placeholder={t('orders.lookupPlaceholder')} autoCapitalize="characters" onSubmitEditing={runLookup} /></View>
        <Button title={t('common.check')} variant="secondary" icon="search-outline" onPress={runLookup} />
      </Row>
      {lookupError ? <Notice tone="warning" text={lookupError} /> : null}

      {!orders.data?.length ? <EmptyState icon="receipt-outline" message={t('orders.empty')} />
        : !list.length ? <T muted style={{ textAlign: 'center', marginTop: spacing.xl }}>{t('orders.tabEmpty')}</T>
        : list.map((o) => {
          const proof = proofs.data?.get(o.id);
          const canPay = inTab(o, 'toPay', reviewSet);
          return (
            <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T weight="700">{o.order_number}</T>
                <T weight="700">{money(o.total_usd)}</T>
              </Row>
              <T size="sm" muted>{o.stores?.name ?? ''} · {formatDate(o.created_at, language)}</T>
              <Row style={{ justifyContent: 'space-between' }}>
                <T size="sm" color={o.status === 'cancelled' ? colors.danger : colors.primary} weight="600">{t(`status.${o.status}` as TranslationKey)}</T>
                <T size="xs" muted>{t(`payStatus.${o.payment_status}` as TranslationKey)}</T>
              </Row>
              {proof ? <T size="xs" color={proof === 'rejected' ? colors.danger : proof === 'approved' ? colors.success : colors.warning}>{t(`proof.status.${proof}` as TranslationKey)}</T> : null}
              {canPay ? (
                <Row style={{ flexWrap: 'wrap' }}>
                  <Button title={t('orders.pay')} icon="card-outline" onPress={() => router.push(`/payment/${o.id}`)} />
                  {proof !== 'pending' ? <Button title={t('orders.submitProof')} variant="secondary" icon="document-attach-outline" onPress={() => router.push(`/order/proof/${o.id}`)} /> : null}
                </Row>
              ) : null}
              {reviewSet.has(o.id) ? <Button title={t('orders.review')} variant="secondary" icon="star-outline" onPress={() => router.push(`/order/review/${o.id}`)} /> : null}
              {TO_RECEIVE.includes(o.status) ? <Button title={t('orders.track')} variant="ghost" icon="navigate-outline" onPress={() => router.push(`/order/${o.id}`)} /> : null}
            </Card>
          );
        })}
    </Screen>
  );
}
