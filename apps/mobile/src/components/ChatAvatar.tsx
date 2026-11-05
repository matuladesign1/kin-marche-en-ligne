import { Image } from 'expo-image';
import { View } from 'react-native';
import { useSettings } from '@/providers/SettingsProvider';
import { VerifiedBadge } from './VerifiedBadge';

const LOGO = require('../../assets/images/logo-round.png');

/** Avatar d'un assistant Kin Marché : logo officiel (rond rouge) + badge certifié. */
export function ChatAvatar({ size = 48, badge = true }: { size?: number; badge?: boolean }) {
  const { colors } = useSettings();
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
        <Image source={LOGO} style={{ width: size, height: size }} contentFit="cover" accessibilityIgnoresInvertColors />
      </View>
      {badge ? (
        <View style={{ position: 'absolute', right: -2, bottom: -2, backgroundColor: colors.background, borderRadius: 10, padding: 1 }}>
          <VerifiedBadge size={Math.max(14, size * 0.34)} />
        </View>
      ) : null}
    </View>
  );
}
