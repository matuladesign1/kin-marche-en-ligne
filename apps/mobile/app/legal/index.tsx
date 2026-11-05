import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { ListGroup, ListRow } from '@/components/kit';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

/** « Politiques légales » : conditions, licence, confidentialité, cookies. */
export default function LegalIndex() {
  const { t, colors } = useSettings();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingVertical: spacing.md }}>
      <ListGroup>
        <ListRow icon="document-text-outline" label={t('account.terms')} onPress={() => router.push('/legal/terms')} />
        <ListRow icon="ribbon-outline" label={t('account.license')} onPress={() => router.push('/legal/license')} />
        <ListRow icon="shield-checkmark-outline" label={t('account.privacy')} onPress={() => router.push('/legal/privacy')} />
        <ListRow icon="options-outline" label={t('account.cookies')} onPress={() => router.push('/legal/cookies')} />
      </ListGroup>
    </ScrollView>
  );
}
