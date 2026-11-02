import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, Loading, Screen, T } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

export default function Coupons() {
  const { t, money, language, colors } = useSettings();
  const q = useQuery({
    queryKey: ['coupons'],
    queryFn: async () => unwrap(await supabase.from('coupons')
      .select('id, code, description, discount_type, discount_value, min_order_usd, ends_at')
      .eq('is_public', true).eq('is_active', true).order('ends_at', { ascending: true, nullsFirst: false })) as
      { id: string; code: string; description: string | null; discount_type: 'percent' | 'fixed'; discount_value: number; min_order_usd: number; ends_at: string | null }[],
  });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <EmptyState icon="pricetag-outline" message={t('coupons.empty')} />;
  return (
    <Screen>
      {q.data.map((c) => (
        <Card key={c.id} style={{ borderStyle: 'dashed', borderColor: colors.primary }}>
          <T size="xl" weight="700" color={colors.primary}>{c.code}</T>
          <T weight="600">{c.discount_type === 'percent' ? `-${c.discount_value} %` : `-${money(c.discount_value)}`}</T>
          {c.description ? <T size="sm">{c.description}</T> : null}
          {c.min_order_usd > 0 ? <T size="xs" muted>min. {money(c.min_order_usd)}</T> : null}
          {c.ends_at ? <T size="xs" muted>→ {formatDate(c.ends_at, language, false)}</T> : null}
        </Card>
      ))}
    </Screen>
  );
}
