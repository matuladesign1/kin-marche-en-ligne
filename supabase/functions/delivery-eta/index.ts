import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply, serverSecret } from '../_shared/server.ts';

// Itinéraire réel du livreur sur les routes d'OpenStreetMap — sans Google ni carte bancaire :
//  1. OpenRouteService si une clé gratuite est configurée (ORS_API_KEY : service prévu pour un usage commercial) ;
//  2. sinon le serveur public OSRM ;
//  3. Google Routes en dernier recours, seulement si une clé Google est configurée.
// Enregistre sur la mission le temps de trajet, la distance et le tracé (vus par le client),
// et renvoie les consignes de navigation quand le livreur est guidé dans l'application (steps: true).
// En route vers le magasin : livreur → magasin → client (le magasin est une étape).
const TO_STORE = ['driver_assigned', 'driver_to_store'];
const TO_CUSTOMER = ['picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'];
const UA = 'KinMarche/2.0 (+https://kin-marche-admin.vercel.app)';

type LatLng = { lat: number; lng: number };
type Step = { type: string; modifier?: string; exit?: number; name: string; distance: number; duration: number; location: [number, number]; leg: number };
type Route = { polyline: string; distance: number; duration: number; legs: { distance: number; duration: number }[]; steps: Step[]; source: string };

const valid = (p: unknown): p is LatLng => {
  const q = p as LatLng | null;
  return !!q && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180 && !(q.lat === 0 && q.lng === 0);
};

/** Décodage d'un tracé « polyline » (précision 5) en [longitude, latitude]. */
function decode(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

async function viaOsrm(points: LatLng[]): Promise<Route | null> {
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline&steps=true`, {
    headers: { 'User-Agent': UA },
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  const r = j?.routes?.[0];
  if (j?.code !== 'Ok' || !r?.geometry) return null;
  const steps: Step[] = [];
  (r.legs ?? []).forEach((leg: any, li: number) => {
    for (const s of leg.steps ?? []) {
      steps.push({
        type: s.maneuver?.type ?? 'continue', modifier: s.maneuver?.modifier, exit: s.maneuver?.exit,
        name: s.name || s.ref || '', distance: s.distance ?? 0, duration: s.duration ?? 0, location: s.maneuver?.location ?? [0, 0], leg: li,
      });
    }
  });
  return {
    polyline: r.geometry, distance: r.distance, duration: r.duration,
    legs: (r.legs ?? []).map((l: any) => ({ distance: l.distance ?? 0, duration: l.duration ?? 0 })), steps, source: 'osrm',
  };
}

// Types de manœuvre OpenRouteService → vocabulaire OSRM utilisé par l'application.
const ORS_TYPES: Record<number, { type: string; modifier?: string }> = {
  0: { type: 'turn', modifier: 'left' }, 1: { type: 'turn', modifier: 'right' },
  2: { type: 'turn', modifier: 'sharp left' }, 3: { type: 'turn', modifier: 'sharp right' },
  4: { type: 'turn', modifier: 'slight left' }, 5: { type: 'turn', modifier: 'slight right' },
  6: { type: 'continue', modifier: 'straight' }, 7: { type: 'roundabout' }, 8: { type: 'continue', modifier: 'straight' },
  9: { type: 'turn', modifier: 'uturn' }, 10: { type: 'arrive' }, 11: { type: 'depart' },
  12: { type: 'fork', modifier: 'slight left' }, 13: { type: 'fork', modifier: 'slight right' },
};

async function viaOrs(points: LatLng[], key: string): Promise<Route | null> {
  const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]), instructions: true, language: 'fr', geometry: true }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  const r = j?.routes?.[0];
  if (!r?.geometry) return null;
  const line = decode(r.geometry);
  const steps: Step[] = [];
  (r.segments ?? []).forEach((seg: any, li: number) => {
    for (const s of seg.steps ?? []) {
      const m = ORS_TYPES[s.type as number] ?? { type: 'continue' };
      steps.push({
        ...m, exit: s.exit_number, name: s.name && s.name !== '-' ? s.name : '', distance: s.distance ?? 0, duration: s.duration ?? 0,
        location: line[s.way_points?.[0] ?? 0] ?? [0, 0], leg: li,
      });
    }
  });
  return {
    polyline: r.geometry, distance: r.summary?.distance ?? 0, duration: r.summary?.duration ?? 0,
    legs: (r.segments ?? []).map((s: any) => ({ distance: s.distance ?? 0, duration: s.duration ?? 0 })), steps, source: 'openrouteservice',
  };
}

async function viaGoogle(points: LatLng[], key: string): Promise<Route | null> {
  const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters',
    },
    body: JSON.stringify({
      origin: waypoint(points[0]), destination: waypoint(points[points.length - 1]), intermediates: points.slice(1, -1).map(waypoint),
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', polylineQuality: 'OVERVIEW',
    }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  const r = j?.routes?.[0];
  if (!r?.polyline?.encodedPolyline) return null;
  const sec = (d: unknown) => parseInt(String(d ?? '0').replace('s', ''), 10) || 0;
  return {
    polyline: r.polyline.encodedPolyline, distance: Number(r.distanceMeters ?? 0), duration: sec(r.duration),
    legs: (r.legs ?? []).map((l: any) => ({ distance: Number(l.distanceMeters ?? 0), duration: sec(l.duration) })), steps: [], source: 'google',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { user } = await currentUser(req);
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);
  const { order_id, force, steps: wantSteps, origin: givenOrigin } = await req.json().catch(() => ({}));
  if (!order_id) return reply({ error: 'INVALID_BODY' }, 400);

  const admin = adminClient();
  const { data: a } = await admin.from('delivery_assignments')
    .select('id, driver_id, eta_updated_at, eta_minutes, eta_target, route_distance_km, route_polyline, orders(status, delivery_address, stores(latitude, longitude)), drivers(current_latitude, current_longitude, location_updated_at)')
    .eq('order_id', order_id).eq('status', 'accepted').maybeSingle();
  if (!a || a.driver_id !== user.id) return reply({ error: 'FORBIDDEN' }, 403);

  // Limites d'appels : suivi = un calcul par minute et par mission (sauf premier tracé) ;
  // navigation guidée = un calcul toutes les 5 secondes au plus (écart au tracé, nouvelle étape).
  const age = a.eta_updated_at ? Date.now() - new Date(a.eta_updated_at).getTime() : Infinity;
  if (wantSteps ? age < 5_000 : age < 60_000 && (a.route_polyline || !force)) return reply({ skipped: true });

  const order: any = a.orders;
  const driver: any = a.drivers;
  // Position du livreur : celle envoyée par la navigation (la plus récente), sinon la dernière partagée.
  const origin: LatLng | null = valid(givenOrigin) ? givenOrigin
    : driver?.current_latitude != null ? { lat: driver.current_latitude, lng: driver.current_longitude } : null;
  if (!origin) return reply({ error: 'NO_DRIVER_POSITION' }, 409);
  const store: LatLng | null = order.stores?.latitude != null ? { lat: order.stores.latitude, lng: order.stores.longitude } : null;
  const customer: LatLng | null = order.delivery_address?.latitude != null
    ? { lat: Number(order.delivery_address.latitude), lng: Number(order.delivery_address.longitude) } : null;

  let points: LatLng[] = [];
  let target = '';
  if (TO_STORE.includes(order.status) && store) {
    target = 'store';
    points = customer ? [origin, store, customer] : [origin, store];
  } else if (TO_CUSTOMER.includes(order.status) && customer) {
    target = 'customer';
    points = [origin, customer];
  }
  if (!points.length) return reply({ error: 'NO_DESTINATION' }, 409);

  const ors = await serverSecret(admin, 'ORS_API_KEY');
  let route = ors ? await viaOrs(points, ors) : null;
  if (!route) route = await viaOsrm(points);
  if (!route) {
    const google = await serverSecret(admin, 'GOOGLE_MAPS_API_KEY');
    if (google) route = await viaGoogle(points, google);
  }
  if (!route) return reply({ error: 'ROUTES_API_ERROR' }, 502);

  // ETA affichée : jusqu'à la prochaine étape (magasin puis client).
  const first = route.legs[0];
  const etaSeconds = target === 'store' && first ? first.duration : route.duration;
  const etaMeters = target === 'store' && first ? first.distance : route.distance;
  const minutes = Math.max(1, Math.round(etaSeconds / 60));
  const km = Math.round(etaMeters / 10) / 100;
  await admin.from('delivery_assignments').update({
    eta_minutes: minutes, route_distance_km: km, eta_updated_at: new Date().toISOString(), eta_target: target,
    route_polyline: route.polyline,
  }).eq('id', a.id);
  return reply({
    eta_minutes: minutes, distance_km: km, target, route_polyline: route.polyline, source: route.source,
    total_minutes: Math.max(1, Math.round(route.duration / 60)),
    total_km: Math.round(route.distance / 10) / 100,
    ...(wantSteps ? { steps: route.steps } : {}),
  });
});
