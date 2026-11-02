import { Card, Divider, ErrorState, Loading, Row, Screen, SectionHeader, T } from '@/components/ui';
import { useLoyalty } from '@/hooks/data';
import { formatDate } from '@/lib/format';
import { useSettings } from '@/providers/SettingsProvider';

export default function Loyalty() {
  const { t, language, colors } = useSettings();
  const q = useLoyalty();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={t('common.error')} onRetry={q.refetch} />;
  const { account, history } = q.data;
  return (
    <Screen>
      <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
        <T size="xxl" weight="700" color={colors.onPrimary}>{t('loyalty.balance', { points: account.points_balance })}</T>
        <T color={colors.onPrimary}>{t('loyalty.tier', { tier: account.tier })}</T>
      </Card>
      <T muted>{t('loyalty.rule')}</T>
      <SectionHeader title={t('loyalty.history')} />
      <Card>
        {history.length === 0 ? <T muted>{t('common.empty')}</T> : history.map((h, i) => (
          <Row key={h.id} style={{ justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderColor: colors.border }}>
            <T size="sm" style={{ flex: 1 }}>{h.note ?? h.type}{'\n'}<T size="xs" muted>{formatDate(h.created_at, language)}</T></T>
            <T weight="700" color={h.points >= 0 ? colors.success : colors.danger}>{h.points > 0 ? '+' : ''}{h.points}</T>
          </Row>
        ))}
      </Card>
    </Screen>
  );
}
