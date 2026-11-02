import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply, serverSecret } from '../_shared/server.ts';

// Calcule le temps de trajet réel du livreur (Google Routes API) et l'enregistre
// sur la mission. Appelé par l'application du livreur ; jamais d'estimation inventée.
const TO_STORE = ['driver_assigned', 'driver_to_store'];
const TO_CUSTOMER = ['picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { user } = await currentUser(req);
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);
  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) return reply({ error: 'INVALID_BODY' }, 400);

  const admin = adminClient();
  const { data: a } = await admin.from('delivery_assignments')
    .select('id, driver_id, eta_updated_at, orders(status, delivery_address, stores(latitude, longitude)), drivers(current_latitude, current_longitude, location_updated_at)')
    .eq('order_id', order_id).eq('status', 'accepted').maybeSingle();
  if (!a || a.driver_id !== user.id) return reply({ error: 'FORBIDDEN' }, 403);

  // Limite d'appels : un calcul par minute et par mission.
  if (a.eta_updated_at && Date.now() - new Date(a.eta_updated_at).getTime() < 60_000) return reply({ skipped: true });

  const order: any = a.orders;
  const driver: any = a.drivers;
  if (driver?.current_latitude == null) return reply({ error: 'NO_DRIVER_POSITION' }, 409);
  let dest: { lat: number; lng: number } | null = null;
  let target = '';
  if (TO_STORE.includes(order.status) && order.stores?.latitude != null) {
    dest = { lat: order.stores.latitude, lng: order.stores.longitude }; target = 'store';
  } else if (TO_CUSTOMER.includes(order.status) && order.delivery_address?.latitude != null) {
    dest = { lat: Number(order.delivery_address.latitude), lng: Number(order.delivery_address.longitude) }; target = 'customer';
  }
  if (!dest) return reply({ error: 'NO_DESTINATION' }, 409);

  const key = await serverSecret(admin, 'GOOGLE_MAPS_API_KEY');
  if (!key) return reply({ error: 'MAPS_NOT_CONFIGURED' }, 503);

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: driver.current_latitude, longitude: driver.current_longitude } } },
      destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });
  const json = await res.json().catch(() => ({}));
  const route = json?.routes?.[0];
  if (!res.ok || !route?.duration) {
    return reply({ error: 'ROUTES_API_ERROR', status: res.status, detail: json?.error?.message ?? null }, 502);
  }
  const minutes = Math.max(1, Math.round(parseInt(String(route.duration).replace('s', ''), 10) / 60));
  const km = Math.round((route.distanceMeters ?? 0) / 10) / 100;
  await admin.from('delivery_assignments').update({
    eta_minutes: minutes, route_distance_km: km, eta_updated_at: new Date().toISOString(), eta_target: target,
  }).eq('id', a.id);
  return reply({ eta_minutes: minutes, distance_km: km, target });
});
