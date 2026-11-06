import { StyleSheet, Text, View } from 'react-native';
import { useSettings } from '@/providers/SettingsProvider';
import { KinLoader } from './KinLoader';

/**
 * Chargement Kin Marché dans les écrans : la boule au logo saute et se transforme en produits
 * (voir KinLoader). Même nom et mêmes options qu'avant : tous les chargements de l'application en profitent.
 */
export function BasketLoader({ size = 'large', label, showLabel = true }: { size?: 'large' | 'small' | 'mini'; label?: string; showLabel?: boolean }) {
  const { colors, t } = useSettings();
  const ball = size === 'large' ? 84 : size === 'small' ? 56 : 30;
  return (
    <View
      style={[styles.center, size === 'mini' ? { flexGrow: 0, paddingVertical: 8 } : null]}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('common.pleaseWait')}
    >
      <KinLoader size={ball} />
      {!showLabel ? null : size === 'large' ? (
        <>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 10 }}>{label ?? t('common.pleaseWait')}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t('loader.tagline')}</Text>
        </>
      ) : size === 'small' ? (
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6 }}>{label ?? t('common.loading')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 16 },
});
