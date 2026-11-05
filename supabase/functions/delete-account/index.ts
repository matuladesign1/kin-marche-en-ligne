import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply } from '../_shared/server.ts';

// Suppression de compte demandée par le client.
// Les données personnelles sont effacées ; les commandes et écritures financières
// sont conservées de façon anonyme (obligations comptables), puis l'accès est bloqué.
const IN_PROGRESS = ['payment_confirmed', 'sent_to_store', 'preparing', 'verified', 'packed', 'ready', 'driver_assigned',
  'driver_to_store', 'picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const { user } = await currentUser(req);
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);
  const { confirm } = await req.json().catch(() => ({}));
  if (confirm !== 'SUPPRIMER') return reply({ error: 'CONFIRMATION_REQUIRED' }, 400);

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role && profile.role !== 'customer') return reply({ error: 'STAFF_ACCOUNT' }, 409);
  const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', user.id).in('status', IN_PROGRESS);
  if ((count ?? 0) > 0) return reply({ error: 'ACTIVE_ORDERS' }, 409);

  // Annule les commandes non payées (libère le stock réservé).
  const { data: unpaid } = await admin.from('orders').select('id').eq('customer_id', user.id).eq('status', 'received');
  for (const o of unpaid ?? []) {
    await admin.rpc('_release_order', { p_order_id: o.id });
    await admin.from('orders').update({ status: 'cancelled', payment_status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: 'Compte supprimé' }).eq('id', o.id);
  }

  await admin.from('addresses').delete().eq('user_id', user.id);
  await admin.from('favorites').delete().eq('user_id', user.id);
  await admin.from('push_tokens').delete().eq('user_id', user.id);
  const { data: cart } = await admin.from('carts').select('id').eq('user_id', user.id).maybeSingle();
  if (cart) await admin.from('cart_items').delete().eq('cart_id', cart.id);
  const { data: avatars } = await admin.storage.from('avatars').list(user.id);
  if (avatars?.length) await admin.storage.from('avatars').remove(avatars.map((f) => `${user.id}/${f.name}`));
  await admin.from('customer_profiles').update({ marketing_opt_in: false, notify_promotions: false, birth_date: null, default_address_id: null }).eq('user_id', user.id);
  await admin.from('profiles').update({ full_name: 'Compte supprimé', phone: null, email: null, avatar_url: null, is_active: false }).eq('id', user.id);
  await admin.from('audit_log').insert({ actor_id: user.id, action: 'account_deleted', entity: 'profiles', entity_id: user.id });

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email: `supprime-${user.id}@compte-supprime.invalid`, phone: '', ban_duration: '876000h', user_metadata: {},
  });
  if (error) return reply({ error: 'AUTH_UPDATE_FAILED', detail: error.message }, 500);
  await admin.auth.admin.signOut(req.headers.get('Authorization')!.replace('Bearer ', ''), 'global').catch(() => undefined);
  return reply({ ok: true });
});
