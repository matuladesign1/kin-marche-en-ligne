import { Image } from 'expo-image';
import { View } from 'react-native';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';
import { T } from './ui';

const LOGO = require('../../assets/images/logo-square.png');

/** Pied de page commun : « Tous droits réservés Kin Marché © 2026 » puis « Développé par Matula Design ». */
export function AppFooter() {
  const { t, colors } = useSettings();
  return (
    <View style={{ alignItems: 'center', gap: 4, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg }}>
      <View style={{ width: 48, height: 2, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm }} />
      <Image source={LOGO} style={{ width: 28, height: 28, opacity: 0.9 }} contentFit="contain" accessibilityIgnoresInvertColors />
      <T size="xs" muted style={{ textAlign: 'center' }}>{t('footer.rights')}</T>
      <T size="xs" weight="600" color={colors.textMuted} style={{ textAlign: 'center' }}>{t('footer.developedBy')}</T>
    </View>
  );
}
