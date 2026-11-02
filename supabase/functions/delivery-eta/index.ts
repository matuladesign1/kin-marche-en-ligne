import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply, serverSecret } from '../_shared/server.ts';

// Calcule l'itinéraire réel du livreur (Google Routes API) : temps de trajet, distance et
// tracé (polyline) enregistrés sur la mission. Jamais d'estimation inventée.
// En route vers le magasin : livreur → magasin → client (le magasin est une étape).
const TO_STORE = ['driver_assigned', 'driver_to_store'];
const TO_CUSTOMER = ['picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'];

type LatLng = { lat: number; lng: number };
const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { user } = await currentUser(req);
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);
  const { order_id, force } = await req.json().catch(() => ({}));
  if (!order_id) return reply({ error: 'INVALID_BODY' }, 400);

  const admin = adminClient();
  const { data: a } = await admin.from('delivery_assignments')
    .select('id, driver_id, eta_updated_at, route_polyline, orders(status, delivery_address, stores(latitude, longitude)), drivers(current_latitude, current_longitude, location_updated_at)')
    .eq('order_id', order_id).eq('status', 'accepted').maybeSingle();
  if (!a || a.driver_id !== user.id) return reply({ error: 'FORBIDDEN' }, 403);

  // Limite d'appels : un calcul par minute et par mission (sauf premier tracé).
  const recent = a.eta_updated_at && Date.now() - new Date(a.eta_updated_at).getTime() < 60_000;
  if (recent && (a.route_polyline || !force)) return reply({ skipped: true });

  const order: any = a.orders;
  const driver: any = a.drivers;
  if (driver?.current_latitude == null) return reply({ error: 'NO_DRIVER_POSITION' }, 409);
  const origin: LatLng = { lat: driver.current_latitude, lng: driver.current_longitude };
  const store: LatLng | null = order.stores?.latitude != null ? { lat: order.stores.latitude, lng: order.stores.longitude } : null;
  const customer: LatLng | null = order.delivery_address?.latitude != null
    ? { lat: Number(order.delivery_address.latitude), lng: Number(order.delivery_address.longitude) } : null;

  let destination: LatLng | null = null;
  let intermediates: LatLng[] = [];
  let target = '';
  if (TO_STORE.includes(order.status) && store) {
    target = 'store';
    if (customer) { destination = customer; intermediates = [store]; } else { destination = store; }
  } else if (TO_CUSTOMER.includes(order.status) && customer) {
    target = 'customer';
    destination = customer;
  }
  if (!destination) return reply({ error: 'NO_DESTINATION' }, 409);

  const key = await serverSecret(admin, 'GOOGLE_MAPS_API_KEY');
  if (!key) return reply({ error: 'MAPS_NOT_CONFIGURED' }, 503);

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters',
    },
    body: JSON.stringify({
      origin: waypoint(origin),
      destination: waypoint(destination),
      intermediates: intermediates.map(waypoint),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      polylineQuality: 'OVERVIEW',
    }),
  });
  const json = await res.json().catch(() => ({}));
  const route = json?.routes?.[0];
  if (!res.ok || !route?.duration) {
    return reply({ error: 'ROUTES_API_ERROR', status: res.status, detail: json?.error?.message ?? null }, 502);
  }
  const seconds = (d: unknown) => parseInt(String(d ?? '0').replace('s', ''), 10) || 0;
  // ETA affichée : jusqu'à la prochaine étape (magasin puis client).
  const firstLeg = route.legs?.[0];
  const etaSeconds = target === 'store' && firstLeg ? seconds(firstLeg.duration) : seconds(route.duration);
  const etaMeters = target === 'store' && firstLeg ? Number(firstLeg.distanceMeters ?? 0) : Number(route.distanceMeters ?? 0);
  const minutes = Math.max(1, Math.round(etaSeconds / 60));
  const km = Math.round(etaMeters / 10) / 100;
  const polyline: string | null = route.polyline?.encodedPolyline ?? null;
  await admin.from('delivery_assignments').update({
    eta_minutes: minutes, route_distance_km: km, eta_updated_at: new Date().toISOString(), eta_target: target,
    route_polyline: polyline,
  }).eq('id', a.id);
  return reply({
    eta_minutes: minutes, distance_km: km, target, route_polyline: polyline,
    total_minutes: Math.max(1, Math.round(seconds(route.duration) / 60)),
    total_km: Math.round(Number(route.distanceMeters ?? 0) / 10) / 100,
  });
});
