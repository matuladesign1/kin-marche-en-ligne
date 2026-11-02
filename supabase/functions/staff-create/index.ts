import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply } from '../_shared/server.ts';

// Création d'un compte « agent » par l'administrateur général : compte de connexion
// (e-mail confirmé, mot de passe provisoire) + accès par mission et par région.
const PERMISSIONS = ['stores', 'drivers', 'support', 'finance', 'users', 'marketing'];
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const { user } = await currentUser(req);
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);

  const admin = adminClient();
  const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle();
  if (me?.role !== 'super_admin' || !me.is_active) return reply({ error: 'FORBIDDEN' }, 403);

  const body = await req.json().catch(() => ({}));
  const email = clean(body.email)?.toLowerCase() ?? '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = clean(body.full_name);
  const phone = clean(body.phone);
  const permissions: string[] = Array.isArray(body.permissions) ? body.permissions.filter((p: string) => PERMISSIONS.includes(p)) : [];
  const province = clean(body.province), city = clean(body.city), commune = clean(body.commune);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'INVALID_EMAIL' }, 400);
  if (!permissions.length) return reply({ error: 'PERMISSIONS_REQUIRED' }, 400);

  const { data: existing } = await admin.from('profiles').select('id, role').eq('email', email).maybeSingle();
  let userId: string;
  let created = false;
  if (existing) {
    if (!['customer', 'agent'].includes(existing.role)) return reply({ error: 'ROLE_CONFLICT', role: existing.role }, 409);
    userId = existing.id;
  } else {
    if (password.length < 10) return reply({ error: 'WEAK_PASSWORD' }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName, phone },
    });
    if (error || !data.user) return reply({ error: 'CREATE_FAILED', detail: error?.message ?? null }, 400);
    userId = data.user.id;
    created = true;
  }

  const patch: Record<string, unknown> = { role: 'agent', is_active: true };
  if (fullName) patch.full_name = fullName;
  if (phone) patch.phone = phone;
  const up = await admin.from('profiles').update(patch).eq('id', userId);
  if (up.error) return reply({ error: 'PROFILE_UPDATE_FAILED', detail: up.error.message }, 500);

  let granted = 0;
  for (const permission of permissions) {
    const { error } = await admin.from('staff_permissions').insert({
      user_id: userId, permission, province, city, commune, granted_by: user.id,
    });
    if (!error) granted++;
    else if (error.code !== '23505') return reply({ error: 'GRANT_FAILED', detail: error.message }, 500);
  }

  await admin.from('notifications').insert({
    user_id: userId, kind: 'staff_access', title: 'Accès agent Kin Marché',
    body: 'Votre compte d’agent est prêt : connectez-vous à l’espace d’administration web.',
  });
  await admin.from('audit_log').insert({
    actor_id: user.id, action: created ? 'staff_create' : 'staff_grant', entity: 'profiles', entity_id: userId,
    details: { email, permissions, province, city, commune },
  });
  return reply({ ok: true, user_id: userId, created, granted });
});
