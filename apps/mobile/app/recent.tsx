import { Alert, ScrollView, View } from 'react-native';
import { ProductGrid } from '@/components/product';
import { Button, EmptyState, Loading } from '@/components/ui';
import { useRecentItems } from '@/hooks/data';
import { clearRecent } from '@/lib/recent';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

/** « Historique » : produits vus récemment sur ce téléphone. */
export default function Recent() {
  const { t, colors } = useSettings();
  const recent = useRecentItems(40);

  if (recent.isLoading) return <Loading />;
  if (!recent.items?.length) return <EmptyState icon="time-outline" message={t('recent.empty')} />;

  const clear = () => Alert.alert(t('recent.clear'), t('recent.clearConfirm'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.confirm'), style: 'destructive', onPress: async () => { await clearRecent(); recent.refresh(); } },
  ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 }}>
      <ProductGrid items={recent.items} emptyMessage={t('recent.empty')} />
      <View style={{ alignItems: 'center' }}>
        <Button title={t('recent.clear')} variant="ghost" icon="trash-outline" onPress={clear} />
      </View>
    </ScrollView>
  );
}
