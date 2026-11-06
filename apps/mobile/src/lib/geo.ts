// Géographie de la carte Kin Marché : projection Web Mercator (tuiles 256 px), distances,
// cadrage et position sur un itinéraire. Aucune dépendance : tout est calculé sur le téléphone.

export type LatLng = { latitude: number; longitude: number };

export const TILE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;
export const KINSHASA: LatLng = { latitude: -4.3317, longitude: 15.3139 };

const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Coordonnées « monde » en pixels au niveau de zoom donné (peut être fractionnaire). */
export function project(p: LatLng, zoom: number): { x: number; y: number } {
  const s = TILE * Math.pow(2, zoom);
  const sin = Math.sin((clampLat(p.latitude) * Math.PI) / 180);
  return {
    x: ((p.longitude + 180) / 360) * s,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s,
  };
}

export function unproject(x: number, y: number, zoom: number): LatLng {
  const s = TILE * Math.pow(2, zoom);
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)), longitude: (x / s) * 360 - 180 };
}

export const isLatLng = (p: Partial<LatLng> | null | undefined): p is LatLng =>
  !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0);

/** Distance à vol d'oiseau en mètres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap de a vers b, en degrés (0 = nord, 90 = est). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const f1 = (a.latitude * Math.PI) / 180, f2 = (b.latitude * Math.PI) / 180;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Centre et zoom qui montrent tous les points dans un cadre l × h (marge en pixels). */
export function fitView(points: LatLng[], w: number, h: number, pad = 48, maxZoom = 16): { center: LatLng; zoom: number } {
  const pts = points.filter(isLatLng);
  if (!pts.length || w <= 0 || h <= 0) return { center: KINSHASA, zoom: 12 };
  const ps = pts.map((p) => project(p, 0));
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = Math.max(maxX - minX, 1e-9), dy = Math.max(maxY - minY, 1e-9);
  const zoom = Math.log2(Math.min(Math.max(w - 2 * pad, 40) / dx, Math.max(h - 2 * pad, 40) / dy));
  return { center: unproject((minX + maxX) / 2, (minY + maxY) / 2, 0), zoom: clamp(zoom, MIN_ZOOM, maxZoom) };
}

/** Projection locale (mètres) autour d'un point : suffisante à l'échelle d'une ville. */
function local(o: LatLng) {
  const k = Math.cos((o.latitude * Math.PI) / 180);
  return (p: LatLng) => ({ x: ((p.longitude - o.longitude) * Math.PI / 180) * 6371000 * k, y: ((p.latitude - o.latitude) * Math.PI / 180) * 6371000 });
}

/** Point de l'itinéraire le plus proche : distance (m), segment, et distance parcourue depuis le départ (m). */
export function nearestOnRoute(p: LatLng, route: LatLng[]): { distance: number; index: number; along: number } {
  if (route.length < 2) return { distance: route.length ? distanceM(p, route[0]) : Infinity, index: 0, along: 0 };
  const L = local(p);
  let best = { distance: Infinity, index: 0, along: 0 };
  let acc = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = L(route[i]), b = L(route[i + 1]);
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? clamp(-(a.x * vx + a.y * vy) / len2, 0, 1) : 0;
    const qx = a.x + t * vx, qy = a.y + t * vy;
    const d = Math.hypot(qx, qy);
    const seg = Math.sqrt(len2);
    if (d < best.distance) best = { distance: d, index: i, along: acc + t * seg };
    acc += seg;
  }
  return best;
}

/** Longueur cumulée de l'itinéraire à chaque point (m). */
export function cumulative(route: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i++) out.push(out[i - 1] + distanceM(route[i - 1], route[i]));
  return out;
}
