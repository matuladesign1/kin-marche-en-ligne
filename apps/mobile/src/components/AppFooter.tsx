import { Image } from 'expo-image';
import { View } from 'react-native';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';
import { T } from './ui';

/** Logo à jour : le logo « ligne » en rouge sur boule blanche, le même que l'animation d'ouverture. */
const LOGO = require('../../assets/images/logo-ball.png');

/** Pied de page commun : logo, « Tous droits réservés Kin Marché © 2026 » puis « Développé par Matula Design ». */
export function AppFooter() {
  const { t, colors } = useSettings();
  return (
    <View style={{ alignItems: 'center', gap: 4, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg }}>
      <View style={{ width: 48, height: 2, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm }} />
      <Image source={LOGO} style={{ width: 56, height: 56, marginBottom: 2 }} contentFit="contain" accessibilityIgnoresInvertColors />
      <T size="xs" muted style={{ textAlign: 'center' }}>{t('footer.rights')}</T>
      <T size="xs" weight="600" color={colors.textMuted} style={{ textAlign: 'center' }}>{t('footer.developedBy')}</T>
    </View>
  );
}
