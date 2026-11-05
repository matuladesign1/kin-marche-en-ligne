import Constants from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
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

export type LatLng = { latitude: number; longitude: number };

/** La carte n'est affichée que si la clé Google Maps a été intégrée au build Android. */
export function mapsAvailable(): boolean {
  const flags = Constants.expoConfig?.extra?.mapsEnabled as Record<string, boolean> | undefined;
  return !!flags?.[Platform.OS];
}

const KINSHASA = { latitude: -4.3317, longitude: 15.3139 };

export function MapBlock({ points, route, height = 240, showsUserLocation = true }: {
  points: MapPoint[]; route?: LatLng[]; height?: number; showsUserLocation?: boolean;
}) {
  const { colors } = useSettings();
  const valid = points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  const path = (route ?? []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (!mapsAvailable() || (valid.length === 0 && path.length === 0)) return null;

  const all = [...valid, ...path];
  const lats = all.map((p) => p.latitude);
  const lngs = all.map((p) => p.longitude);
  const center = all.length ? { latitude: (Math.min(...lats) + Math.max(...lats)) / 2, longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2 } : KINSHASA;
  const delta = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs), 0.02) * 1.5;

  return (
    <View style={[styles.wrap, { height, borderColor: colors.border }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        region={{ ...center, latitudeDelta: delta, longitudeDelta: delta }}
        showsUserLocation={showsUserLocation}
        toolbarEnabled={false}
      >
        {path.length > 1 ? (
          <>
            <Polyline coordinates={path} strokeColor="#FFFFFF" strokeWidth={8} />
            <Polyline coordinates={path} strokeColor={colors.accent} strokeWidth={5} />
          </>
        ) : null}
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

/**
 * Aperçu du tracé sans fond de carte (quand la carte Google n'est pas intégrée à l'APK) :
 * dessine fidèlement l'itinéraire calculé par Google, avec le départ, le magasin et le client.
 */
export function RouteSketch({ route, marks, height = 200 }: {
  route: LatLng[]; marks: (LatLng & { id: string; color: string; label: string })[]; height?: number;
}) {
  const { colors } = useSettings();
  const all = [...route, ...marks];
  if (all.length < 2) return null;
  // Projection équirectangulaire locale (suffisante à l'échelle d'une ville).
  const lat0 = all.reduce((s, p) => s + p.latitude, 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p.longitude * k);
  const ys = all.map((p) => -p.latitude);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-4);
  const pad = 18;
  const size = 300;
  const px = (p: LatLng) => pad + ((p.longitude * k - minX) / span) * (size - 2 * pad);
  const py = (p: LatLng) => pad + ((-p.latitude - minY) / span) * (size - 2 * pad);
  const d = route.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p).toFixed(1)} ${py(p).toFixed(1)}`).join(' ');
  return (
    <View style={[styles.wrap, { height, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet">
        {[1, 2, 3, 4, 5].map((i) => (
          <Rect key={`g${i}`} x={0} y={(size / 6) * i} width={size} height={0.6} fill={colors.border} />
        ))}
        {route.length > 1 ? (
          <>
            <Path d={d} stroke="#FFFFFF" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={d} stroke={colors.accent} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : null}
        {marks.map((m) => (
          <Circle key={m.id} cx={px(m)} cy={py(m)} r={7} fill={m.color} stroke="#FFFFFF" strokeWidth={2.5} />
        ))}
        {marks.map((m) => (
          <SvgText key={`${m.id}-t`} x={px(m) + 10} y={py(m) - 8} fontSize={11} fontWeight="700" fill={colors.text}>{m.label}</SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1 },
});
