import { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// Badge « livreur certifié » : sceau festonné (comme le badge bleu de Facebook),
// en dégradé vert -> bleu, coche blanche. Affiché seulement pour un livreur vérifié par Kin Marché.
export const CERTIFIED_GREEN = '#16C47F';
export const CERTIFIED_BLUE = '#1877F2';

function scallop(cx: number, cy: number, r: number, depth: number, bumps: number): string {
  const steps = bumps * 12;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps - Math.PI / 2;
    const rr = r + depth * Math.cos(bumps * a);
    d += `${i === 0 ? 'M' : 'L'}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)} `;
  }
  return `${d}Z`;
}
const SEAL = scallop(12, 12, 10.6, 1.15, 10);

export function CertifiedBadge({ size = 18, label = 'Livreur certifié' }: { size?: number; label?: string }) {
  const id = `kmcert${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityRole="image" accessibilityLabel={label}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={CERTIFIED_GREEN} />
          <Stop offset="1" stopColor={CERTIFIED_BLUE} />
        </LinearGradient>
      </Defs>
      <Path d={SEAL} fill={`url(#${id})`} />
      <Path d="M7.3 12.3 L10.5 15.4 L16.9 9" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
