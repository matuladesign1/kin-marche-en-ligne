import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply, serverSecret } from '../_shared/server.ts';

// Itinéraire d'un client vers un magasin Kin Marché, affiché sur la carte de l'application :
// tracé, distance et durée selon le moyen de transport (à pied, vélo, moto ou voiture).
// OpenRouteService (clé ORS_API_KEY, gardée sur le serveur) en priorité ; serveurs publics OSRM en secours.
type Mode = 'walk' | 'bike' | 'drive';
type LatLng = { lat: number; lng: number };
type Route = { polyline: string; distance: number; duration: number; source: string };

const ORS_PROFILE: Record<Mode, string> = { walk: 'foot-walking', bike: 'cycling-regular', drive: 'driving-car' };
const ORS_BASES = ['https://api.heigit.org/openrouteservice/v2/directions', 'https://api.openrouteservice.org/v2/directions'];
const OSRM_BASE: Record<Mode, string> = {
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
  drive: 'https://router.project-osrm.org/route/v1/driving',
};
const UA = 'KinMarche/2.0 (+https://kin-marche-admin.vercel.app)';
/** Au-delà, ce n'est plus un trajet en ville (position fausse ou autre pays). */
const MAX_KM = 300;

const valid = (p: unknown): p is LatLng => {
  const q = p as LatLng | null;
  return !!q && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180 && !(q.lat === 0 && q.lng === 0);
};

function km(a: LatLng, b: LatLng): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Réservé aux clients connectés, avec une limite par compte : protège le quota gratuit d'OpenRouteService.
const recent = new Map<string, number[]>();
function allowed(who: string, max: number): boolean {
  const now = Date.now();
  const list = (recent.get(who) ?? []).filter((t) => now - t < 5 * 60_000);
  if (list.length >= max) { recent.set(who, list); return false; }
  list.push(now);
  recent.set(who, list);
  if (recent.size > 5000) recent.clear();
  return true;
}

async function viaOrs(from: LatLng, to: LatLng, mode: Mode, key: string): Promise<Route | null> {
  for (const base of ORS_BASES) {
    const res = await fetch(`${base}/${ORS_PROFILE[mode]}`, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]], instructions: false, geometry: true }),
    }).catch(() => null);
    if (!res?.ok) continue;
    const j = await res.json().catch(() => null);
    const r = j?.routes?.[0];
    if (r?.geometry) return { polyline: r.geometry, distance: r.summary?.distance ?? 0, duration: r.summary?.duration ?? 0, source: 'openrouteservice' };
  }
  return null;
}

async function viaOsrm(from: LatLng, to: LatLng, mode: Mode): Promise<Route | null> {
  const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  const res = await fetch(`${OSRM_BASE[mode]}/${coords}?overview=full&geometries=polyline`, { headers: { 'User-Agent': UA } }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  const r = j?.routes?.[0];
  if (j?.code !== 'Ok' || !r?.geometry) return null;
  return { polyline: r.geometry, distance: r.distance ?? 0, duration: r.duration ?? 0, source: 'osrm' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { user } = await currentUser(req).catch(() => ({ user: null }));
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);
  const { store_id, origin, mode } = await req.json().catch(() => ({}));
  if (typeof store_id !== 'string' || !valid(origin) || typeof mode !== 'string' || !(mode in ORS_PROFILE)) {
    return reply({ error: 'INVALID_BODY' }, 400);
  }
  if (!allowed(user.id, 40)) return reply({ error: 'RATE_LIMITED' }, 429);

  const admin = adminClient();
  const { data: s } = await admin.from('stores').select('id, latitude, longitude, is_active').eq('id', store_id).maybeSingle();
  if (!s || !s.is_active) return reply({ error: 'STORE_NOT_FOUND' }, 404);
  if (s.latitude == null || s.longitude == null) return reply({ error: 'STORE_NO_POSITION' }, 409);
  const to: LatLng = { lat: Number(s.latitude), lng: Number(s.longitude) };
  if (km(origin, to) > MAX_KM) return reply({ error: 'TOO_FAR' }, 422);

  const key = await serverSecret(admin, 'ORS_API_KEY');
  const route = (key ? await viaOrs(origin, to, mode as Mode, key) : null) ?? (await viaOsrm(origin, to, mode as Mode));
  if (!route) return reply({ error: 'ROUTES_API_ERROR' }, 502);
  return reply({
    mode, source: route.source, route_polyline: route.polyline,
    distance_m: Math.round(route.distance), duration_s: Math.round(route.duration),
  });
});
