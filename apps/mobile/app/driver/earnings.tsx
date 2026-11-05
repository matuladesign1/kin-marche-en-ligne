import { useQuery } from '@tanstack/react-query';
import { Card, Loading, Row, Screen, SectionHeader, T } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function Earnings() {
  const { t, money, language, colors } = useSettings();
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['driver-earnings'],
    enabled: !!session,
    queryFn: async () => {
      const [w, tx, n] = await Promise.all([
        supabase.from('driver_wallets').select('balance_usd').eq('driver_id', session!.user.id).maybeSingle(),
        supabase.from('driver_transactions').select('id, amount_usd, kind, paid_by, created_at').eq('driver_id', session!.user.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('delivery_assignments').select('id', { count: 'exact', head: true }).eq('driver_id', session!.user.id).eq('status', 'completed'),
      ]);
      return {
        balance: Number(w.data?.balance_usd ?? 0),
        tx: (tx.data ?? []) as { id: string; amount_usd: number; kind: string; paid_by: string | null; created_at: string }[],
        deliveries: n.count ?? 0,
      };
    },
  });
  if (q.isLoading || !q.data) return <Loading />;
  return (
    <Screen>
      <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
        <T size="xxl" weight="700" color={colors.onPrimary}>{t('driver.balance', { amount: money(q.data.balance) })}</T>
        <T color={colors.onPrimary}>{q.data.deliveries} ✓</T>
      </Card>
      <SectionHeader title={t('loyalty.history')} />
      <Card>
        {q.data.tx.length === 0 ? <T muted>{t('common.empty')}</T> : q.data.tx.map((x) => (
          <Row key={x.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
            <T size="sm" style={{ flex: 1 }}>{x.kind}{x.paid_by ? ` · ${x.paid_by}` : ''}{'\n'}<T size="xs" muted>{formatDate(x.created_at, language)}</T></T>
            <T weight="700" color={Number(x.amount_usd) >= 0 ? colors.success : colors.danger}>{money(x.amount_usd)}</T>
          </Row>
        ))}
      </Card>
    </Screen>
  );
}
