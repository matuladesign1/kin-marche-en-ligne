import { cumulative, nearestOnRoute, type LatLng } from './geo';
import type { TFunction } from './i18n';

// Navigation guidée Kin Marché : consignes de l'itinéraire calculé par le serveur (routes OpenStreetMap),
// position du livreur sur le tracé, prochaine manœuvre et distance restante.

export interface NavStep {
  /** depart, turn, new name, continue, merge, on ramp, off ramp, fork, end of road, roundabout, rotary, arrive… */
  type: string;
  /** left, right, slight left, slight right, sharp left, sharp right, straight, uturn */
  modifier?: string;
  exit?: number;
  name: string;
  distance: number;
  duration: number;
  /** [longitude, latitude] de la manœuvre */
  location: [number, number];
  /** Étape du trajet : 0 = vers la 1re destination (magasin), 1 = vers la suivante. */
  leg?: number;
}

export interface RouteResult {
  route_polyline: string | null;
  eta_minutes?: number;
  distance_km?: number;
  total_minutes?: number;
  total_km?: number;
  target?: 'store' | 'customer';
  steps?: NavStep[];
  source?: string;
  skipped?: boolean;
}

export function formatDistance(m: number, t: TFunction): string {
  if (!Number.isFinite(m)) return '';
  if (m < 950) return t('nav.m', { n: Math.max(10, Math.round(m / 10) * 10) });
  return t('nav.km', { n: (Math.round(m / 100) / 10).toString().replace('.', ',') });
}

/** Phrase de la manœuvre, dans la langue de l'application. */
export function instruction(step: NavStep, t: TFunction): string {
  const m = step.modifier ?? '';
  let action: string;
  if (step.type === 'arrive') return t('nav.arrive');
  if (step.type === 'depart') action = t('nav.depart');
  else if (step.type === 'roundabout' || step.type === 'rotary' || step.type === 'roundabout turn') {
    action = step.exit ? t('nav.roundaboutExit', { n: step.exit }) : t('nav.roundabout');
  } else if (m === 'uturn') action = t('nav.uturn');
  else if (m === 'sharp left') action = t('nav.sharpLeft');
  else if (m === 'sharp right') action = t('nav.sharpRight');
  else if (m === 'slight left') action = step.type === 'fork' || step.type === 'merge' ? t('nav.keepLeft') : t('nav.slightLeft');
  else if (m === 'slight right') action = step.type === 'fork' || step.type === 'merge' ? t('nav.keepRight') : t('nav.slightRight');
  else if (m === 'left') action = t('nav.left');
  else if (m === 'right') action = t('nav.right');
  else action = t('nav.straight');
  return step.name ? t('nav.onto', { action, street: step.name }) : action;
}

/** Icône de la manœuvre (MaterialCommunityIcons). */
export function maneuverIcon(step: NavStep | null): string {
  if (!step) return 'navigation-variant';
  if (step.type === 'arrive') return 'flag-checkered';
  if (step.type === 'roundabout' || step.type === 'rotary' || step.type === 'roundabout turn') return 'rotate-right';
  switch (step.modifier) {
    case 'uturn': return 'arrow-u-left-top';
    case 'sharp left': return 'arrow-bottom-left';
    case 'sharp right': return 'arrow-bottom-right';
    case 'slight left': return 'arrow-top-left';
    case 'slight right': return 'arrow-top-right';
    case 'left': return 'arrow-left-top';
    case 'right': return 'arrow-right-top';
    default: return 'arrow-up';
  }
}

export interface NavProgress {
  /** Distance au tracé (m) : au-delà de ~40 m, le livreur s'est écarté et l'itinéraire est recalculé. */
  offRoute: number;
  /** Distance déjà parcourue sur le tracé (m). */
  along: number;
  /** Distance restante jusqu'à la destination finale (m). */
  remaining: number;
  /** Prochaine manœuvre et distance pour l'atteindre (m). */
  next: NavStep | null;
  toNext: number;
}

/** Où en est le livreur sur l'itinéraire. */
export function progressOn(pos: LatLng, route: LatLng[], steps: NavStep[]): NavProgress {
  const cum = cumulative(route);
  const total = cum[cum.length - 1] ?? 0;
  const here = nearestOnRoute(pos, route);
  // Position de chaque manœuvre le long du tracé (calcul local, rapide pour quelques dizaines de consignes).
  let next: NavStep | null = null;
  let toNext = 0;
  for (const s of steps) {
    if (s.type === 'depart') continue;
    const at = nearestOnRoute({ latitude: s.location[1], longitude: s.location[0] }, route).along;
    if (at > here.along + 8) { next = s; toNext = at - here.along; break; }
  }
  return { offRoute: here.distance, along: here.along, remaining: Math.max(0, total - here.along), next, toNext };
}

/** Position d'une manœuvre le long du tracé (m). */
export function alongOf(step: NavStep, route: LatLng[]): number {
  return nearestOnRoute({ latitude: step.location[1], longitude: step.location[0] }, route).along;
}
