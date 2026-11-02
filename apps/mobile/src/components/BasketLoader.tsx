import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSettings } from '@/providers/SettingsProvider';

// Animation de chargement Kin Marché : le panier se balance pendant que les articles
// (fruits, pain, gâteau, carton…) et les mots « Kin », « Marché », « Matula » tombent dedans.
type Piece = { kind: 'emoji'; value: string } | { kind: 'word'; value: string; color: 'primary' | 'accent' | 'accent2' };

const PIECES: Piece[] = [
  { kind: 'emoji', value: '🍎' },
  { kind: 'word', value: 'Kin', color: 'primary' },
  { kind: 'emoji', value: '🍞' },
  { kind: 'emoji', value: '🍌' },
  { kind: 'word', value: 'Marché', color: 'primary' },
  { kind: 'emoji', value: '🎂' },
  { kind: 'emoji', value: '📦' },
  { kind: 'emoji', value: '🥛' },
  { kind: 'word', value: 'Matula', color: 'accent2' },
  { kind: 'emoji', value: '🍇' },
  { kind: 'emoji', value: '🍍' },
  { kind: 'emoji', value: '🧴' },
];

const STEP = 260;        // décalage entre deux articles (ms)
const FALL = 900;        // durée d'une chute (ms)

function Basket({ width, primary, dark }: { width: number; primary: string; dark: string }) {
  const h = width * 0.78;
  return (
    <Svg width={width} height={h} viewBox="0 0 200 156">
      <Defs>
        <LinearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={primary} />
          <Stop offset="1" stopColor={dark} />
        </LinearGradient>
      </Defs>
      {/* poignée */}
      <Path d="M18 30 L40 30 L58 110" stroke={dark} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* corps du panier */}
      <Path d="M46 52 L190 52 L172 112 L62 112 Z" fill="url(#body)" />
      {/* grille */}
      {[0, 1, 2, 3].map((i) => (
        <Rect key={`v${i}`} x={74 + i * 26} y={60} width={10} height={44} rx={3} fill="#FFFFFF" opacity={0.85} />
      ))}
      <Rect x={58} y={78} width={118} height={7} rx={3} fill="#FFFFFF" opacity={0.6} />
      {/* base et roues */}
      <Path d="M58 112 L60 124 L176 124" stroke={dark} strokeWidth={8} strokeLinecap="round" fill="none" />
      <Circle cx={78} cy={142} r={12} fill={dark} />
      <Circle cx={78} cy={142} r={4} fill="#FFFFFF" />
      <Circle cx={160} cy={142} r={12} fill={dark} />
      <Circle cx={160} cy={142} r={4} fill="#FFFFFF" />
    </Svg>
  );
}

export function BasketLoader({ size = 'large', label }: { size?: 'large' | 'small'; label?: string }) {
  const { colors, t } = useSettings();
  const width = size === 'large' ? 200 : 120;
  const scale = width / 200;
  const sway = useRef(new Animated.Value(0)).current;
  const falls = useMemo(() => PIECES.map(() => new Animated.Value(0)), []);
  const dots = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const swayLoop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const cycle = PIECES.length * STEP + FALL;
    const fallLoop = Animated.loop(Animated.stagger(STEP, falls.map((v) => Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: FALL, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]))), { resetBeforeIteration: true });
    const dotsLoop = Animated.loop(Animated.timing(dots, { toValue: 3, duration: 1200, easing: Easing.linear, useNativeDriver: false }));
    swayLoop.start();
    fallLoop.start();
    dotsLoop.start();
    void cycle;
    return () => { swayLoop.stop(); fallLoop.stop(); dotsLoop.stop(); };
  }, [sway, falls, dots]);

  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });
  const shiftX = sway.interpolate({ inputRange: [-1, 1], outputRange: [-8 * scale, 8 * scale] });
  const areaH = width * 1.25;

  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? t('common.pleaseWait')}>
      <View style={{ width: width * 1.3, height: areaH + width * 0.78 * 0.5 }}>
        {PIECES.map((p, i) => {
          const v = falls[i];
          const lane = ((i * 37) % 5) - 2; // positions horizontales variées
          const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [-20 * scale, areaH * 0.62] });
          const opacity = v.interpolate({ inputRange: [0, 0.08, 0.8, 1], outputRange: [0, 1, 1, 0] });
          const spin = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 ? 1 : -1) * 200}deg`] });
          const s = v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0.6] });
          return (
            <Animated.View
              key={i}
              style={[styles.piece, {
                left: width * 0.65 + lane * 14 * scale - 14 * scale,
                transform: [{ translateY }, { rotate: p.kind === 'word' ? '0deg' : spin }, { scale: s }],
                opacity,
              }]}
            >
              {p.kind === 'emoji' ? (
                <Text style={{ fontSize: 26 * scale }}>{p.value}</Text>
              ) : (
                <Text style={{
                  fontSize: 15 * scale, fontWeight: '800', color: '#FFFFFF', paddingHorizontal: 6 * scale, paddingVertical: 2,
                  borderRadius: 6, overflow: 'hidden',
                  backgroundColor: p.color === 'primary' ? colors.primary : p.color === 'accent' ? colors.accent : colors.accent2,
                }}>{p.value}</Text>
              )}
            </Animated.View>
          );
        })}
        <Animated.View style={[styles.basket, { top: areaH * 0.55, transform: [{ translateX: shiftX }, { rotate }] }]}>
          <Basket width={width} primary={colors.primary} dark={colors.primaryDark} />
        </Animated.View>
      </View>
      {size === 'large' ? (
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 8 }}>{label ?? t('common.pleaseWait')}</Text>
      ) : (
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label ?? t('common.loading')}</Text>
      )}
      {size === 'large' ? <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t('app.tagline')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16 },
  piece: { position: 'absolute', top: 0 },
  basket: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
