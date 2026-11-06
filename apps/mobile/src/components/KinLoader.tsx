import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import ICONS from './loader/icons.json';

/**
 * Animation de chargement Kin Marché.
 * La boule au logo officiel saute, retombe au même endroit et, à chaque impact, se transforme
 * en un produit dessiné au trait (pomme, tomates, huile, boisson, pain, panier, lait, riz,
 * légumes, conserves, produits ménagers), puis revient au logo. Tout tourne sur le fil
 * graphique natif (useNativeDriver) : 60 images/s sans solliciter le JavaScript.
 */

export const KM_RED = '#CE0000';
/** Turquoise du logo « ligne » (anneau et chariot). */
export const KM_TURQUOISE = '#1CB7B8';
/** Boule du logo : logo « ligne » officiel (anneau blanc, lettres blanches, anneau et chariot turquoise) sur sphère rouge. */
const LOGO_BALL = require('../../assets/images/logo-ball.png');

type LineIcon = { key: string; label: string; paths: { d: string; accent?: boolean }[] };
const PRODUCTS = ICONS as LineIcon[];
/** Étape 0 = logo, puis chaque produit, puis retour au logo. */
export const LOADER_STEPS = PRODUCTS.length + 1;

// Un saut en trois tiers égaux (750 ms) : montée, descente, puis impact + changement d'objet + rebond.
const RISE = 250;
const FALL = 250;
const IMPACT = 70;
const SETTLE = 180;
const MORPH = 200;

/** Une boule : le logo (étape 0) ou un produit au trait sur une sphère blanche. */
const Ball = memo(function Ball({ step, size, onRed }: { step: number; size: number; onRed: boolean }) {
  if (step === 0) {
    return <Image source={LOGO_BALL} style={{ width: size, height: size }} contentFit="contain" accessibilityIgnoresInvertColors />;
  }
  const icon = PRODUCTS[(step - 1) % PRODUCTS.length];
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Defs>
        <RadialGradient id="kmBall" cx="0.36" cy="0.3" r="0.75">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.7" stopColor="#F3F3F3" />
          <Stop offset="1" stopColor="#DCDCDC" />
        </RadialGradient>
      </Defs>
      <Circle cx={24} cy={24} r={23.5} fill="url(#kmBall)" stroke={onRed ? 'none' : '#E3E3E3'} strokeWidth={onRed ? 0 : 0.6} />
      <G scale={0.78} origin="24, 24">
        {icon.paths.map((p, i) => (
          <Path key={i} d={p.d} fill="none" stroke={p.accent ? KM_TURQUOISE : KM_RED} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </G>
    </Svg>
  );
});

/**
 * Boule qui rebondit et se transforme. `size` : diamètre de la boule ; `jump` : hauteur du saut ;
 * `onRed` : version pour fond rouge (anneau blanc autour du logo, ombre plus sombre).
 */
export function KinLoader({ size = 96, jump, onRed = false, style }: { size?: number; jump?: number; onRed?: boolean; style?: StyleProp<ViewStyle> }) {
  const H = jump ?? Math.round(size * 0.95);
  const y = useRef(new Animated.Value(0)).current; // 0 au sol, 1 au sommet
  const squash = useRef(new Animated.Value(0)).current; // -1 étirée (chute), 0 ronde, 1 écrasée (impact)
  const fade = useRef(new Animated.Value(0)).current; // 0 : calque A visible, 1 : calque B visible
  const front = useRef<0 | 1>(0);
  const [slots, setSlots] = useState<[number, number]>([0, 1]);

  useEffect(() => {
    let alive = true;
    const jumpOnce = () => {
      const toB = front.current === 0;
      Animated.sequence([
        Animated.timing(y, { toValue: 1, duration: RISE, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(y, { toValue: 0, duration: FALL, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(squash, { toValue: -1, duration: FALL, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.sequence([
            Animated.timing(squash, { toValue: 1, duration: IMPACT, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(squash, { toValue: 0, duration: SETTLE, easing: Easing.elastic(1.4), useNativeDriver: true }),
          ]),
          Animated.timing(fade, { toValue: toB ? 1 : 0, duration: MORPH, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        ]),
      ]).start(({ finished }) => {
        if (!alive || !finished) return;
        front.current = toB ? 1 : 0;
        // Le calque désormais caché reçoit l'objet suivant : il n'apparaîtra qu'au prochain impact.
        setSlots((s) => {
          const next = (s[front.current] + 1) % LOADER_STEPS;
          return front.current === 1 ? [next, s[1]] : [s[0], next];
        });
        jumpOnce();
      });
    };
    jumpOnce();
    return () => {
      alive = false;
      y.stopAnimation();
      squash.stopAnimation();
      fade.stopAnimation();
    };
  }, [y, squash, fade]);

  const lift = y.interpolate({ inputRange: [0, 1], outputRange: [0, -H] });
  const scaleX = squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.93, 1, 1.18] });
  const scaleY = squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.08, 1, 0.8] });
  // Le bas de la boule reste posé au sol pendant l'écrasement.
  const anchor = squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [-0.04 * size, 0, 0.1 * size] });
  const tilt = y.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-9deg'] });
  // Le calque du dessus (B) apparaît pendant que celui du dessous (A) reste plein : jamais de boule transparente.
  const aOpacity = fade.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1, 0] });
  const bOpacity = fade.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] });
  const aTurn = fade.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-70deg'] });
  const bTurn = fade.interpolate({ inputRange: [0, 1], outputRange: ['70deg', '0deg'] });
  const shadowScale = Animated.multiply(y.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }), scaleX);
  const shadowOpacity = y.interpolate({ inputRange: [0, 1], outputRange: [onRed ? 0.55 : 0.3, onRed ? 0.18 : 0.1] });
  const shadowH = Math.max(4, size * 0.14);

  return (
    <View style={[{ width: size * 1.3, height: H + size + shadowH }, style]} pointerEvents="none">
      <Animated.View
        style={[styles.shadow, { width: size * 0.9, height: shadowH, left: size * 0.2, opacity: shadowOpacity, transform: [{ scaleX: shadowScale }] }]}
      >
        {/* Ombre douce au sol : ellipse dégradée, plus petite et plus claire quand la boule est en l'air. */}
        <Svg width="100%" height="100%" viewBox="0 0 100 20" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="kmShadow" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor={onRed ? '#3A0000' : '#000000'} stopOpacity="1" />
              <Stop offset="0.6" stopColor={onRed ? '#3A0000' : '#000000'} stopOpacity="0.55" />
              <Stop offset="1" stopColor={onRed ? '#3A0000' : '#000000'} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={50} cy={10} rx={50} ry={10} fill="url(#kmShadow)" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute', left: size * 0.15, top: H, width: size, height: size,
          transform: [{ translateY: Animated.add(lift, anchor) }, { rotate: tilt }, { scaleX }, { scaleY }],
        }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: aOpacity, transform: [{ rotate: aTurn }] }]}>
          <Ball step={slots[0]} size={size} onRed={onRed} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: bOpacity, transform: [{ rotate: bTurn }] }]}>
          <Ball step={slots[1]} size={size} onRed={onRed} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Trois points turquoise qui s'allument tour à tour : indication de chargement discrète. */
export function LoadingDots({ color = KM_TURQUOISE }: { color?: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 3, duration: 1500, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[styles.dot, {
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, i, i + 0.5, i + 1, 3], outputRange: [0.3, 0.3, 1, 0.3, 0.3], extrapolate: 'clamp' }),
            transform: [{ scale: v.interpolate({ inputRange: [0, i, i + 0.5, i + 1, 3], outputRange: [1, 1, 1.35, 1, 1], extrapolate: 'clamp' }) }],
          }]}
        />
      ))}
    </View>
  );
}

const SCREEN_BALL = 112;
const SCREEN_JUMP = 104;
const SCREEN_SHADOW = Math.max(4, SCREEN_BALL * 0.14);

/**
 * Écran de chargement plein écran (démarrage, téléchargement de la mise à jour) : fond rouge Kin Marché
 * et la boule animée seule, sans texte. Au repos, la boule est au centre exact de l'écran, à la même place
 * et à la même taille que l'image de l'écran natif : le passage de l'un à l'autre ne se voit pas.
 * `children` s'affiche sous la boule (par exemple la progression du téléchargement).
 */
export function LoadingScreen({ children, onLayout }: { children?: ReactNode; onLayout?: () => void }) {
  return (
    <View style={styles.screen} onLayout={onLayout} accessibilityRole="progressbar" accessibilityLabel="Kin Marché">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="kmScreen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#DE0000" />
            <Stop offset="0.55" stopColor={KM_RED} />
            <Stop offset="1" stopColor="#A00000" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#kmScreen)" />
      </Svg>
      <View style={styles.content}>
        <KinLoader size={SCREEN_BALL} jump={SCREEN_JUMP} onRed style={{ transform: [{ translateY: -(SCREEN_JUMP - SCREEN_SHADOW) / 2 }] }} />
      </View>
      {children ? <View style={styles.below}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', bottom: 0 },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 16 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: KM_RED },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  below: { position: 'absolute', left: 28, right: 28, top: '50%', marginTop: SCREEN_BALL / 2 + 36, alignItems: 'center' },
});
