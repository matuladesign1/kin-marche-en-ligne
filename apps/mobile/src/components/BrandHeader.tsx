import { Image } from 'expo-image';
import { View } from 'react-native';
import { useSettings } from '@/providers/SettingsProvider';

// Logo officiel (thème). Remplaçable par l'administrateur via app_settings.branding.logo_wide_url.
const LOCAL_LOGO = require('../../assets/images/logo-wide.png');

export function BrandLogo({ height = 48 }: { height?: number }) {
  const { branding, t } = useSettings();
  const source = branding.logo_wide_url ? { uri: branding.logo_wide_url } : LOCAL_LOGO;
  return (
    <View style={{ alignItems: 'center' }}>
      <Image
        source={source}
        style={{ height, width: height * (604 / 186) }}
        contentFit="contain"
        accessibilityLabel={t('app.name')}
      />
    </View>
  );
}
