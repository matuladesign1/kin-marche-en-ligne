import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated, Linking, PanResponder, Pressable, StyleSheet, Text, View,
  type LayoutChangeEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { clamp, fitView, isLatLng, KINSHASA, MAX_ZOOM, MIN_ZOOM, project, TILE, unproject, type LatLng } from '@/lib/geo';
import { useSettings } from '@/providers/SettingsProvider';

// Carte Kin Marché : notre propre carte, sans Google. Fond OpenStreetMap (tuiles 256 px),
// déplacement à un doigt, zoom à deux doigts ou avec les boutons, repères (magasins, client, livreur,
// ma position), tracé de l'itinéraire et trajet déjà parcouru. Mode « suivi » pour la navigation.
// Le fond de carte se change sans toucher au code (extra.mapTilesUrl dans app.config).

const extra = (Constants.expoConfig?.extra ?? {}) as { mapTilesUrl?: string; mapAttribution?: string };
const TILE_URL = extra.mapTilesUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = extra.mapAttribution || '© OpenStreetMap';
/** OpenStreetMap demande que chaque application s'identifie. */
const TILE_HEADERS = { 'User-Agent': 'KinMarche/2.0 (+https://kin-marche-admin.vercel.app)' };
const SUBDOMAINS = ['a', 'b', 'c'];
/** Marge dessinée autour de l'écran : rien ne manque pendant un déplacement. */
const MARGIN = 360;

function tileUrl(z: number, x: number, y: number): string {
  return TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    .replace('{s}', SUBDOMAINS[(x + y) % SUBDOMAINS.length]).replace('{r}', '@2x');
}

export type MarkerKind = 'store' | 'home' | 'driver' | 'me' | 'point';

export interface KinMarker {
  id: string;
  latitude: number;
  longitude: number;
  kind: MarkerKind;
  label?: string;
  /** Cap en degrés (0 = nord) : flèche de direction du livreur. */
  heading?: number | null;
  color?: string;
  active?: boolean;
  onPress?: () => void;
}

export interface KinMapHandle {
  /** Recadre sur tous les repères et l'itinéraire. */
  fit(): void;
}

interface Props {
  markers?: KinMarker[];
  route?: LatLng[];
  /** Trajet déjà parcouru par le livreur (pointillés). */
  trail?: LatLng[];
  /** Hauteur fixe ; sans hauteur, la carte remplit son parent. */
  height?: number;
  /** Suit ce point (navigation) tant que l'utilisateur ne déplace pas la carte. */
  follow?: LatLng | null;
  followZoom?: number;
  /** Repère fixe au centre : on déplace la carte sous le repère (choix d'une position exacte). */
  centerPin?: boolean;
  onCenterChange?: (center: LatLng) => void;
  initialCenter?: LatLng;
  initialZoom?: number;
  /** Change de valeur → la carte se recadre sur tous les points. */
  fitKey?: string;
  controls?: boolean;
  showLabels?: boolean;
  rounded?: boolean;
  style?: StyleProp<ViewStyle>;
  onUserMove?: () => void;
}

type ViewState = { center: LatLng; zoom: number };

export const KinMap = forwardRef<KinMapHandle, Props>(function KinMap(props, ref) {
  const {
    markers = [], route, trail, height, follow, followZoom = 17, centerPin, onCenterChange, initialCenter, initialZoom,
    fitKey, controls = true, showLabels = false, rounded = true, style, onUserMove,
  } = props;
  const { colors } = useSettings();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewState>(() => ({
    center: isLatLng(follow) ? follow : isLatLng(initialCenter) ? initialCenter : KINSHASA,
    zoom: isLatLng(follow) ? followZoom : initialZoom ?? 12,
  }));
  const [userMoved, setUserMoved] = useState(false);

  const containerRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;
  const pendingReset = useRef(false);
  const g = useRef({ mode: 'none' as 'none' | 'pan' | 'pinch', s: 1, tx: 0, ty: 0, baseDx: 0, baseDy: 0, d0: 1, f0x: 0, f0y: 0, moved: false });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const movedCb = useRef(onUserMove);
  movedCb.current = onUserMove;

  const points = useMemo(() => [
    ...markers.filter(isLatLng).map((m) => ({ latitude: m.latitude, longitude: m.longitude })),
    ...(route ?? []).filter(isLatLng),
  ], [markers, route]);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!w || !pointsRef.current.length) return;
    setView(fitView(pointsRef.current, w, h));
  }, []);
  useImperativeHandle(ref, () => ({ fit }), [fit]);

  // Cadrage automatique : à la première mesure, puis à chaque nouvelle valeur de fitKey.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!size.w || isLatLng(follow) || !points.length) return;
    const key = fitKey ?? 'auto';
    if (fitted.current === key) return;
    fitted.current = key;
    setView(fitView(points, size.w, size.h));
  }, [size.w, size.h, fitKey, follow, points]);

  // Navigation : la carte suit le livreur tant qu'il ne la déplace pas lui-même.
  useEffect(() => {
    if (isLatLng(follow) && !userMoved) setView((v) => ({ center: follow, zoom: v.zoom }));
  }, [follow?.latitude, follow?.longitude, userMoved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onCenterChange?.(view.center); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Après le dessin de la nouvelle vue, on retire la transformation provisoire du geste.
  useLayoutEffect(() => {
    if (!pendingReset.current) return;
    pendingReset.current = false;
    translate.setValue({ x: 0, y: 0 });
    scale.setValue(1);
  }, [view, translate, scale]);

  const commit = useCallback(() => {
    const st = g.current;
    const { s, tx, ty } = st;
    st.s = 1; st.tx = 0; st.ty = 0;
    if (s === 1 && tx === 0 && ty === 0) return;
    pendingReset.current = true;
    setView((v) => {
      const c = project(v.center, v.zoom);
      return { center: unproject(c.x - tx / s, c.y - ty / s, v.zoom), zoom: clamp(v.zoom + Math.log2(s), MIN_ZOOM, MAX_ZOOM) };
    });
  }, []);

  const markMoved = useCallback(() => {
    if (g.current.moved) return;
    g.current.moved = true;
    setUserMoved(true);
    movedCb.current?.();
  }, []);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      const st = g.current;
      st.mode = 'none'; st.s = 1; st.tx = 0; st.ty = 0; st.moved = false;
      containerRef.current?.measure((_x, _y, _w, _h, px, py) => { origin.current = { x: px, y: py }; });
    },
    onPanResponderMove: (e, gs) => {
      const st = g.current;
      const touches = e.nativeEvent.touches;
      if (touches.length >= 2) {
        const a = touches[0], b = touches[1];
        const fx = (a.pageX + b.pageX) / 2 - origin.current.x;
        const fy = (a.pageY + b.pageY) / 2 - origin.current.y;
        const d = Math.max(10, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY));
        if (st.mode !== 'pinch') {
          if (st.mode === 'pan') commit();
          st.mode = 'pinch'; st.d0 = d; st.f0x = fx; st.f0y = fy;
        }
        const { w, h } = sizeRef.current;
        const s = clamp(d / st.d0, 0.2, 8);
        st.s = s;
        st.tx = (st.f0x - w / 2) * (1 - s) + (fx - st.f0x);
        st.ty = (st.f0y - h / 2) * (1 - s) + (fy - st.f0y);
      } else {
        if (st.mode !== 'pan') {
          if (st.mode === 'pinch') commit();
          st.mode = 'pan'; st.baseDx = gs.dx; st.baseDy = gs.dy;
        }
        st.s = 1;
        st.tx = gs.dx - st.baseDx;
        st.ty = gs.dy - st.baseDy;
      }
      if (st.s !== 1 || Math.abs(st.tx) + Math.abs(st.ty) > 8) markMoved();
      translate.setValue({ x: st.tx, y: st.ty });
      scale.setValue(st.s);
    },
    onPanResponderRelease: () => { commit(); g.current.mode = 'none'; },
    onPanResponderTerminate: () => { commit(); g.current.mode = 'none'; },
  }), [commit, markMoved, translate, scale]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ w: width, h });
    containerRef.current?.measure((_x, _y, _w, _h, px, py) => { origin.current = { x: px, y: py }; });
  };

  const zoomBy = (d: number) => setView((v) => ({ center: v.center, zoom: clamp(Math.round(v.zoom) + d, MIN_ZOOM, MAX_ZOOM) }));
  const recenter = () => {
    g.current.moved = false;
    setUserMoved(false);
    if (isLatLng(follow)) setView({ center: follow, zoom: followZoom });
    else fit();
  };

  // Vue courante : coin haut-gauche de l'écran en pixels « monde ».
  const c = project(view.center, view.zoom);
  const x0 = c.x - size.w / 2;
  const y0 = c.y - size.h / 2;
  const toScreen = (p: LatLng) => {
    const q = project(p, view.zoom);
    return { x: q.x - x0, y: q.y - y0 };
  };

  const tiles = useMemo(() => {
    if (!size.w || !size.h) return [];
    const out: { key: string; uri: string; left: number; top: number; size: number }[] = [];
    // Niveau inférieur en fond (déjà en cache le plus souvent) : pas d'écran gris pendant le chargement.
    for (const z of [Math.round(view.zoom) - 1, Math.round(view.zoom)]) {
      if (z < 0 || z > MAX_ZOOM) continue;
      const ts = TILE * Math.pow(2, view.zoom - z);
      const cw = project(view.center, view.zoom);
      const left0 = cw.x - size.w / 2 - MARGIN, top0 = cw.y - size.h / 2 - MARGIN;
      const n = Math.pow(2, z);
      for (let ty = Math.floor(top0 / ts); ty <= Math.floor((top0 + size.h + 2 * MARGIN) / ts); ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = Math.floor(left0 / ts); tx <= Math.floor((left0 + size.w + 2 * MARGIN) / ts); tx++) {
          const wx = ((tx % n) + n) % n;
          out.push({ key: `${z}/${wx}/${ty}/${tx}`, uri: tileUrl(z, wx, ty), left: tx * ts - (cw.x - size.w / 2), top: ty * ts - (cw.y - size.h / 2), size: ts });
        }
      }
    }
    return out;
  }, [view, size]);

  const line = (pts: LatLng[] | undefined) => (pts ?? []).filter(isLatLng)
    .map((p) => { const s = toScreen(p); return `${(s.x + MARGIN).toFixed(1)},${(s.y + MARGIN).toFixed(1)}`; }).join(' ');
  const routeLine = route && route.length > 1 ? line(route) : '';
  const trailLine = trail && trail.length > 1 ? line(trail) : '';

  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      style={[styles.wrap, height ? { height } : { flex: 1 }, rounded && styles.rounded, { backgroundColor: '#E8E4DC', borderColor: colors.border }, style]}
      {...responder.panHandlers}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] }]}>
        {tiles.map((t) => (
          <Image key={t.key} source={{ uri: t.uri, headers: TILE_HEADERS }} recyclingKey={t.key} cachePolicy="memory-disk" transition={120}
            style={{ position: 'absolute', left: t.left, top: t.top, width: t.size + 0.6, height: t.size + 0.6 }} />
        ))}
        {routeLine || trailLine ? (
          <Svg width={size.w + 2 * MARGIN} height={size.h + 2 * MARGIN} style={{ position: 'absolute', left: -MARGIN, top: -MARGIN }} pointerEvents="none">
            {trailLine ? <Polyline points={trailLine} fill="none" stroke="#6B7280" strokeWidth={4} strokeDasharray="2,7" strokeLinecap="round" strokeLinejoin="round" /> : null}
            {routeLine ? (
              <>
                <Polyline points={routeLine} fill="none" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
                <Polyline points={routeLine} fill="none" stroke="#1A73E8" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : null}
          </Svg>
        ) : null}
        {markers.filter(isLatLng).map((m) => {
          const p = toScreen(m);
          if (p.x < -MARGIN || p.y < -MARGIN || p.x > size.w + MARGIN || p.y > size.h + MARGIN) return null;
          return <MarkerAt key={m.id} m={m} x={p.x} y={p.y} showLabel={showLabels || !!m.active} primary={colors.primary} accent={colors.accent} />;
        })}
      </Animated.View>

      {centerPin ? (
        <View pointerEvents="none" style={[styles.centerPin, { left: size.w / 2 - PIN_W / 2, top: size.h / 2 - PIN_H }]}>
          <PinShape color={colors.primary} icon="location" />
        </View>
      ) : null}

      {controls ? (
        <View style={styles.controls}>
          <MapButton icon="add" onPress={() => zoomBy(1)} />
          <MapButton icon="remove" onPress={() => zoomBy(-1)} />
          <MapButton icon={isLatLng(follow) ? 'navigate' : 'scan-outline'} active={isLatLng(follow) && !userMoved} onPress={recenter} />
        </View>
      ) : null}

      <Pressable onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')} style={styles.attribution} hitSlop={6}>
        <Text style={styles.attributionText} maxFontSizeMultiplier={1}>{ATTRIBUTION}</Text>
      </Pressable>
    </View>
  );
});

function MapButton({ icon, onPress, active }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.7 : 1 }]} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={active ? '#1A73E8' : '#202124'} />
    </Pressable>
  );
}

const PIN_W = 34;
const PIN_H = 44;
const DRIVER = 52;
const ME = 30;

function PinShape({ color, icon, active }: { color: string; icon: keyof typeof Ionicons.glyphMap; active?: boolean }) {
  return (
    <View style={{ width: PIN_W, height: PIN_H, alignItems: 'center', transform: [{ scale: active ? 1.15 : 1 }] }}>
      <View style={[styles.pinHead, { backgroundColor: color }]}>
        <Ionicons name={icon} size={17} color="#FFFFFF" />
      </View>
      <View style={[styles.pinTail, { borderTopColor: color }]} />
    </View>
  );
}

const MarkerAt = memo(function MarkerAt({ m, x, y, showLabel, primary, accent }: {
  m: KinMarker; x: number; y: number; showLabel: boolean; primary: string; accent: string;
}) {
  let body: ReactNode;
  let w = PIN_W, h = PIN_H, ax = PIN_W / 2, ay = PIN_H;
  if (m.kind === 'me') {
    w = ME; h = ME; ax = ME / 2; ay = ME / 2;
    body = (
      <View style={styles.meWrap}>
        <View style={styles.meHalo} />
        <View style={styles.meDot} />
      </View>
    );
  } else if (m.kind === 'driver') {
    w = DRIVER; h = DRIVER; ax = DRIVER / 2; ay = DRIVER / 2;
    body = (
      <View style={styles.driverWrap}>
        {m.heading != null && Number.isFinite(m.heading) ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ rotate: `${m.heading}deg` }] }]}>
            <View style={[styles.arrow, { borderBottomColor: m.color ?? '#13A35F' }]} />
          </View>
        ) : null}
        <View style={[styles.driverDot, { backgroundColor: m.color ?? '#13A35F' }]}>
          <MaterialCommunityIcons name="moped" size={21} color="#FFFFFF" />
        </View>
      </View>
    );
  } else {
    const icon = m.kind === 'store' ? 'storefront' : m.kind === 'home' ? 'home' : 'location';
    const color = m.color ?? (m.kind === 'store' ? primary : m.kind === 'home' ? accent : '#202124');
    body = <PinShape color={color} icon={icon} active={m.active} />;
  }
  const content = (
    <>
      {body}
      {showLabel && m.label ? (
        <View style={[styles.label, { top: h + 2, left: w / 2 - 70 }]} pointerEvents="none">
          <Text numberOfLines={1} style={styles.labelText} maxFontSizeMultiplier={1.1}>{m.label}</Text>
        </View>
      ) : null}
    </>
  );
  const pos = { position: 'absolute' as const, left: x - ax, top: y - ay, width: w, height: h };
  return m.onPress ? (
    <Pressable onPress={m.onPress} hitSlop={8} style={pos} accessibilityRole="button" accessibilityLabel={m.label}>{content}</Pressable>
  ) : (
    <View style={pos} pointerEvents="none">{content}</View>
  );
});

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  rounded: { borderRadius: 14 },
  controls: { position: 'absolute', right: 10, top: 10, gap: 8 },
  btn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    elevation: 3, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  attribution: { position: 'absolute', left: 6, bottom: 4, backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  attributionText: { fontSize: 10, color: '#333333' },
  centerPin: { position: 'absolute' },
  pinHead: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: '#FFFFFF',
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 2 },
  },
  pinTail: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 11, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -2 },
  meWrap: { width: ME, height: ME, alignItems: 'center', justifyContent: 'center' },
  meHalo: { position: 'absolute', width: ME, height: ME, borderRadius: ME / 2, backgroundColor: 'rgba(26,115,232,0.2)' },
  meDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#1A73E8', borderWidth: 3, borderColor: '#FFFFFF', elevation: 3 },
  driverWrap: { width: DRIVER, height: DRIVER, alignItems: 'center', justifyContent: 'center' },
  driverDot: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF',
    elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  arrow: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  label: { position: 'absolute', width: 140, alignItems: 'center' },
  labelText: {
    fontSize: 11, fontWeight: '700', color: '#202124', backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 6, paddingVertical: 1.5,
    borderRadius: 6, overflow: 'hidden',
  },
});
