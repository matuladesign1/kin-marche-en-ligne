import Constants from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { radius } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  description?: string;
  color?: string;
  onPress?: () => void;
}

/** La carte n'est affichée que si la clé Google Maps a été intégrée au build Android. */
export function mapsAvailable(): boolean {
  const flags = Constants.expoConfig?.extra?.mapsEnabled as Record<string, boolean> | undefined;
  return !!flags?.[Platform.OS];
}

const KINSHASA = { latitude: -4.3317, longitude: 15.3139 };

export function MapBlock({ points, height = 240 }: { points: MapPoint[]; height?: number }) {
  const { colors } = useSettings();
  const valid = points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (!mapsAvailable() || valid.length === 0) return null;

  const lats = valid.map((p) => p.latitude);
  const lngs = valid.map((p) => p.longitude);
  const center = valid.length ? { latitude: (Math.min(...lats) + Math.max(...lats)) / 2, longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2 } : KINSHASA;
  const delta = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs), 0.02) * 1.6;

  return (
    <View style={[styles.wrap, { height, borderColor: colors.border }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        region={{ ...center, latitudeDelta: delta, longitudeDelta: delta }}
        showsUserLocation
        toolbarEnabled={false}
      >
        {valid.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            title={p.title}
            description={p.description}
            pinColor={p.color ?? colors.primary}
            onCalloutPress={p.onPress}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1 },
});
