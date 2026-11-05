import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSettings } from '@/providers/SettingsProvider';

// Animation Kin Marché : le panier au logo de l'application se balance pendant que les
// articles (fruits, pain, gâteau, carton, boissons…) et les mots « Kin », « Marché », « Matula » tombent dedans.
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Tone = 'primary' | 'accent' | 'accent2' | 'success' | 'warning';
type Piece = { kind: 'icon'; icon: IconName; tone: Tone } | { kind: 'word'; value: string; tone: Tone };

const PIECES: Piece[] = [
  { kind: 'icon', icon: 'food-apple', tone: 'primary' },
  { kind: 'word', value: 'Kin', tone: 'primary' },
  { kind: 'icon', icon: 'baguette', tone: 'warning' },
  { kind: 'icon', icon: 'fruit-grapes', tone: 'accent2' },
  { kind: 'word', value: 'Marché', tone: 'primary' },
  { kind: 'icon', icon: 'cake-variant', tone: 'primary' },
  { kind: 'icon', icon: 'package-variant-closed', tone: 'warning' },
  { kind: 'icon', icon: 'bottle-soda-classic', tone: 'accent' },
  { kind: 'word', value: 'Matula', tone: 'accent2' },
  { kind: 'icon', icon: 'carrot', tone: 'warning' },
  { kind: 'icon', icon: 'fish', tone: 'accent' },
  { kind: 'icon', icon: 'cheese', tone: 'warning' },
  { kind: 'icon', icon: 'egg', tone: 'accent2' },
  { kind: 'icon', icon: 'fruit-pineapple', tone: 'success' },
];

const STEP = 240;        // décalage entre deux articles (ms)
const FALL = 950;        // durée d'une chute (ms)
const LOGO = require('../../assets/images/logo-square.png');

function Basket({ width, primary, dark }: { width: number; primary: string; dark: string }) {
  const h = width * 0.78;
  return (
    <Svg width={width} height={h} viewBox="0 0 200 156">
      <Defs>
        <LinearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={primary} />
          <Stop offset="1" stopColor={dark} />
        </LinearGradient>
        <LinearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.25" />
          <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Ellipse cx={118} cy={150} rx={70} ry={5} fill="#000000" opacity={0.12} />
      <Path d="M18 30 L40 30 L58 110" stroke={dark} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M46 52 L190 52 L172 112 L62 112 Z" fill="url(#body)" />
      <Path d="M46 52 L190 52 L184 72 L52 72 Z" fill="url(#shine)" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Rect key={`v${i}`} x={66 + i * 24} y={60} width={7} height={44} rx={3} fill="#FFFFFF" opacity={0.35} />
      ))}
      <Path d="M58 112 L60 124 L176 124" stroke={dark} strokeWidth={8} strokeLinecap="round" fill="none" />
      <Circle cx={78} cy={140} r={12} fill={dark} />
      <Circle cx={78} cy={140} r={4} fill="#FFFFFF" />
      <Circle cx={160} cy={140} r={12} fill={dark} />
      <Circle cx={160} cy={140} r={4} fill="#FFFFFF" />
    </Svg>
  );
}

export function BasketLoader({ size = 'large', label, showLabel = true }: { size?: 'large' | 'small' | 'mini'; label?: string; showLabel?: boolean }) {
  const { colors, t } = useSettings();
  const width = size === 'large' ? 200 : size === 'small' ? 120 : 72;
  const scale = width / 200;
  const sway = useRef(new Animated.Value(0)).current;
  const falls = useMemo(() => PIECES.map(() => new Animated.Value(0)), []);
  const tone = (k: Tone) => ({ primary: colors.primary, accent: colors.accent, accent2: colors.accent2, success: colors.success, warning: colors.warning })[k];

  useEffect(() => {
    const swayLoop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const fallLoop = Animated.loop(Animated.stagger(STEP, falls.map((v) => Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: FALL, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]))), { resetBeforeIteration: true });
    swayLoop.start();
    fallLoop.start();
    return () => { swayLoop.stop(); fallLoop.stop(); };
  }, [sway, falls]);

  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });
  const shiftX = sway.interpolate({ inputRange: [-1, 1], outputRange: [-8 * scale, 8 * scale] });
  const areaH = width * 1.25;
  const basketH = width * 0.78;
  const logo = 46 * scale;
  const bubble = 34 * scale;

  return (
    <View
      style={[styles.center, size === 'mini' ? { flexGrow: 0, paddingVertical: 8 } : null]}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('common.pleaseWait')}
    >
      <View style={{ width: width * 1.3, height: areaH + basketH * 0.5 }}>
        {PIECES.map((p, i) => {
          const v = falls[i];
          const lane = ((i * 37) % 5) - 2;
          const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [-20 * scale, areaH * 0.62] });
          const opacity = v.interpolate({ inputRange: [0, 0.08, 0.8, 1], outputRange: [0, 1, 1, 0] });
          const spin = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 ? 1 : -1) * 160}deg`] });
          const s = v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0.55] });
          return (
            <Animated.View
              key={i}
              style={[styles.piece, {
                left: width * 0.65 + lane * 14 * scale - bubble / 2,
                transform: [{ translateY }, { rotate: p.kind === 'word' ? '0deg' : spin }, { scale: s }],
                opacity,
              }]}
            >
              {p.kind === 'icon' ? (
                <View style={[styles.bubble, { width: bubble, height: bubble, borderRadius: bubble / 2, backgroundColor: colors.surface }]}>
                  <MaterialCommunityIcons name={p.icon} size={20 * scale} color={tone(p.tone)} />
                </View>
              ) : (
                <Text style={{
                  fontSize: Math.max(9, 15 * scale), fontWeight: '800', color: '#FFFFFF', paddingHorizontal: 6 * scale, paddingVertical: 2,
                  borderRadius: 6, overflow: 'hidden', backgroundColor: tone(p.tone),
                }}>{p.value}</Text>
              )}
            </Animated.View>
          );
        })}
        <Animated.View style={[styles.basket, { top: areaH * 0.55, transform: [{ translateX: shiftX }, { rotate }] }]}>
          <View style={{ width, height: basketH }}>
            <Basket width={width} primary={colors.primary} dark={colors.primaryDark} />
            <View
              style={[styles.logoPlate, {
                left: ((118 - 23) / 200) * width - 2,
                top: (59 / 156) * basketH - 2,
                width: logo + 4, height: logo + 4, borderRadius: 10 * scale + 2,
              }]}
            >
              <Image source={LOGO} style={{ width: logo, height: logo }} contentFit="contain" accessibilityIgnoresInvertColors />
            </View>
          </View>
        </Animated.View>
      </View>
      {!showLabel ? null : size === 'large' ? (
        <>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 8 }}>{label ?? t('common.pleaseWait')}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t('app.tagline')}</Text>
        </>
      ) : size === 'small' ? (
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label ?? t('common.loading')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16 },
  piece: { position: 'absolute', top: 0 },
  bubble: {
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  basket: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logoPlate: { position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.0)' },
});
