import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Card, ErrorState, Loading, Screen, T, type IconName } from '@/components/ui';
import { useCategories } from '@/hooks/data';
import { localized } from '@/lib/i18n';
import { radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

export default function Categories() {
  const { t, language, colors } = useSettings();
  const { data, isLoading, error, refetch } = useCategories();
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={t('common.error')} onRetry={refetch} />;
  return (
    <Screen>
      <View style={styles.grid}>
        {(data ?? []).filter((c) => !c.parent_id).map((c) => (
          <View key={c.id} style={styles.cell}>
            <Card onPress={() => router.push(`/category/${c.id}`)} style={{ alignItems: 'center', minHeight: 110, justifyContent: 'center' }}>
              <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name={((c.icon ?? 'pricetag') + '-outline') as IconName} size={24} color={colors.primary} />
              </View>
              <T size="sm" weight="600" style={{ textAlign: 'center' }}>{localized(c.name, language, c.slug)}</T>
            </Card>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { width: '50%', padding: spacing.xs },
  icon: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
