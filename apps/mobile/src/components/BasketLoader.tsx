import { StyleSheet, View } from 'react-native';
import { useSettings } from '@/providers/SettingsProvider';
import { KinLoader } from './KinLoader';

/**
 * Chargement Kin Marché dans les écrans : seulement la boule au logo qui saute et se transforme en produits
 * (voir KinLoader), sans texte. Même nom et mêmes options qu'avant : tous les chargements de l'application en profitent.
 * Le texte (`label`) reste lu par les lecteurs d'écran.
 */
export function BasketLoader({ size = 'large', label }: { size?: 'large' | 'small' | 'mini'; label?: string; showLabel?: boolean }) {
  const { t } = useSettings();
  const ball = size === 'large' ? 84 : size === 'small' ? 56 : 30;
  return (
    <View
      style={[styles.center, size === 'mini' ? { flexGrow: 0, paddingVertical: 8 } : null]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('common.pleaseWait')}
    >
      <KinLoader size={ball} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
