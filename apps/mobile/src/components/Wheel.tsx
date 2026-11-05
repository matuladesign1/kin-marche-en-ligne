import { Image } from 'expo-image';
import { Animated, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Text as SvgText, TSpan } from 'react-native-svg';
import { localized } from '@/lib/i18n';
import type { WheelPrize } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

const LOGO = require('../../assets/images/logo-square.png');

/** Point sur le cercle : angle en degrés, 0 = en haut, sens des aiguilles d'une montre. */
function polar(c: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [c + r * Math.sin(a), c - r * Math.cos(a)];
}

function segmentPath(c: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(c, r, from);
  const [x1, y1] = polar(c, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${c} ${c} L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

/** Coupe un libellé long en deux lignes. */
function lines(label: string): string[] {
  if (label.length <= 9 || !label.includes(' ')) return [label];
  const words = label.split(' ');
  let best = [label, ''];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) { bestDiff = diff; best = [a, b]; }
  }
  return best;
}

/** Angle (en degrés) à ajouter à la rotation actuelle pour que le lot `index` s'arrête sous le pointeur. */
export function landingDelta(current: number, index: number, count: number, turns = 6): number {
  const seg = 360 / count;
  const center = (index + 0.5) * seg;
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const target = (((360 - center + jitter) % 360) + 360) % 360;
  const now = ((current % 360) + 360) % 360;
  const delta = (((target - now) % 360) + 360) % 360;
  return turns * 360 + delta;
}

/** La roue : segments aux couleurs des lots, jante lumineuse, pointeur et logo au centre. */
export function Wheel({ prizes, size, rotation }: { prizes: WheelPrize[]; size: number; rotation: Animated.Value }) {
  const { language, colors } = useSettings();
  const n = Math.max(prizes.length, 1);
  const seg = 360 / n;
  const S = 300; // repère interne
  const C = S / 2;
  const R = 132;
  const fontSize = n <= 6 ? 15 : n <= 8 ? 13 : 11;
  const rotate = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  const bulbs = Array.from({ length: 18 }, (_, i) => polar(C, R + 9, (360 / 18) * i));

  return (
    <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel={prizes.map((p) => localized(p.label_i18n, language, p.label)).join(', ')}>
      {/* Jante fixe */}
      <Svg width={size} height={size} viewBox={`0 0 ${S} ${S}`} style={{ position: 'absolute' }}>
        <Circle cx={C} cy={C} r={R + 15} fill={colors.primaryDark} />
        <Circle cx={C} cy={C} r={R + 4} fill="#FFFFFF" />
        {bulbs.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={3.6} fill={i % 2 ? '#FFE082' : '#FFFFFF'} />)}
      </Svg>

      {/* Disque qui tourne */}
      <Animated.View style={{ position: 'absolute', width: size, height: size, transform: [{ rotate }] }}>
        <Svg width={size} height={size} viewBox={`0 0 ${S} ${S}`}>
          <G>
            {prizes.length === 1 ? (
              <Circle cx={C} cy={C} r={R} fill={prizes[0].color} />
            ) : prizes.map((p, i) => (
              <Path key={p.id} d={segmentPath(C, R, i * seg, (i + 1) * seg)} fill={p.color} stroke="#FFFFFF" strokeWidth={2} />
            ))}
            {prizes.map((p, i) => {
              const label = lines(localized(p.label_i18n, language, p.label));
              const mid = (i + 0.5) * seg;
              return (
                <G key={`t${p.id}`} transform={`rotate(${mid.toFixed(2)} ${C} ${C})`}>
                  <SvgText x={C} y={C - R * 0.66 - (label.length - 1) * fontSize * 0.5} fill="#FFFFFF" fontSize={fontSize} fontWeight="bold" textAnchor="middle">
                    {label.map((l, k) => <TSpan key={k} x={C} dy={k === 0 ? 0 : fontSize * 1.1}>{l}</TSpan>)}
                  </SvgText>
                </G>
              );
            })}
          </G>
        </Svg>
      </Animated.View>

      {/* Moyeu, logo et pointeur (fixes) */}
      <Svg width={size} height={size} viewBox={`0 0 ${S} ${S}`} style={{ position: 'absolute' }} pointerEvents="none">
        <Circle cx={C} cy={C} r={34} fill="#FFFFFF" stroke={colors.primaryDark} strokeWidth={5} />
        <Polygon points={`${C - 15},6 ${C + 15},6 ${C},40`} fill="#16181D" stroke="#FFFFFF" strokeWidth={3} strokeLinejoin="round" />
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', left: size / 2 - size * 0.075, top: size / 2 - size * 0.075, width: size * 0.15, height: size * 0.15 }}>
        <Image source={LOGO} style={{ width: '100%', height: '100%' }} contentFit="contain" accessibilityIgnoresInvertColors />
      </View>
    </View>
  );
}
