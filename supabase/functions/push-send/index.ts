import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, reply, serverSecret } from '../_shared/server.ts';

// Appelée par la base (trigger sur notifications) avec un secret partagé.
// Envoie la notification aux téléphones de l'utilisateur via le service Expo Push.
Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const admin = adminClient();
  const expected = await serverSecret(admin, 'PUSH_WEBHOOK_SECRET');
  if (!expected || req.headers.get('x-push-secret') !== expected) return reply({ error: 'FORBIDDEN' }, 403);

  const { notification_id } = await req.json().catch(() => ({}));
  const { data: n } = await admin.from('notifications').select('id, user_id, kind, title, body, data').eq('id', notification_id).maybeSingle();
  if (!n) return reply({ error: 'NOT_FOUND' }, 404);
  const { data: tokens } = await admin.from('push_tokens').select('token').eq('user_id', n.user_id);
  if (!tokens?.length) return reply({ sent: 0 });

  // Même canal Android que l'application (lib/notify.ts : channelForKind).
  // Offre de course : canal « appel » (sonnerie de 25 s, écran verrouillé, Ne pas déranger), valable 2 minutes.
  const channelId = n.kind === 'delivery_offer' ? 'missions_appel'
    : ['order_status', 'new_order', 'no_driver'].includes(n.kind) ? 'orders'
    : ['message', 'ticket'].includes(n.kind) ? 'messages'
    : ['promo', 'marketing'].includes(n.kind) ? 'promos' : 'general';
  // Promotion avec photo : affichée en grand dans la notification (Android l'affiche directement).
  const image = typeof n.data?.image_url === 'string' && /^https:\/\//.test(n.data.image_url) ? n.data.image_url : null;
  const messages = tokens.map((t) => ({
    to: t.token, title: n.title, body: n.body ?? undefined, sound: 'default', priority: 'high',
    channelId,
    ...(n.kind === 'delivery_offer' ? { ttl: 120 } : {}),
    ...(image ? { richContent: { image } } : {}),
    data: { ...(n.data ?? {}), notification_id: n.id, kind: n.kind },
  }));
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const accessToken = await serverSecret(admin, 'EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(messages) });
  const json = await res.json().catch(() => ({}));
  // Jetons expirés (application désinstallée) : on les retire.
  const tickets: any[] = json?.data ?? [];
  const dead = tickets.map((tk, i) => (tk?.details?.error === 'DeviceNotRegistered' ? messages[i].to : null)).filter(Boolean);
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead as string[]);
  return reply({ sent: messages.length, removed: dead.length, ok: res.ok });
});
