import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, Loading, Row, Screen, T } from '@/components/ui';
import { qk, useAddresses } from '@/hooks/data';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

export default function Addresses() {
  const { t, colors } = useSettings();
  const q = useAddresses();
  const qc = useQueryClient();
  if (q.isLoading) return <Loading />;

  const remove = (id: string) =>
    Alert.alert(t('address.title'), t('cart.remove') + ' ?', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: async () => {
        await supabase.from('addresses').delete().eq('id', id);
        qc.invalidateQueries({ queryKey: qk.addresses });
      } },
    ]);

  return (
    <Screen>
      {(q.data ?? []).length === 0 ? <EmptyState icon="location-outline" message={t('common.empty')} /> : null}
      {(q.data ?? []).map((a) => (
        <Card key={a.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="700">{a.label}</T>
            {a.is_default ? <T size="xs" color={colors.primary}>{t('address.default')}</T> : null}
          </Row>
          <T size="sm" muted>{[a.avenue && `${a.avenue} ${a.street_number ?? ''}`.trim(), a.quartier, a.commune, a.city].filter(Boolean).join(', ')}</T>
          {a.landmark ? <T size="xs" muted>{a.landmark}</T> : null}
          <T size="xs" color={a.latitude != null ? colors.success : colors.warning}>{a.latitude != null ? t('address.gpsSaved') : t('err.ADDRESS_NEEDS_GPS')}</T>
          <Button title={t('cart.remove')} variant="ghost" onPress={() => remove(a.id)} />
        </Card>
      ))}
      <Button title={t('address.new')} icon="add" onPress={() => router.push('/addresses/new')} />
    </Screen>
  );
}
