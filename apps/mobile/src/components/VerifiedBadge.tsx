import Svg, { Path } from 'react-native-svg';
import { useSettings } from '@/providers/SettingsProvider';

// Badge « certifié » (rosette dentelée + coche), aux couleurs de Kin Marché.
function rosette(cx: number, cy: number, outer: number, inner: number, points: number): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}
const SEAL = rosette(12, 12, 11.5, 9.6, 12);

export function VerifiedBadge({ size = 16, color }: { size?: number; color?: string }) {
  const { colors } = useSettings();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="Certifié">
      <Path d={SEAL} fill={color ?? colors.primary} stroke={color ?? colors.primary} strokeWidth={1.2} strokeLinejoin="round" />
      <Path d="M7.4 12.4 L10.6 15.4 L16.8 9" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
