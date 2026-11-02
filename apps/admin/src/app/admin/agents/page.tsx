import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { PERMISSION_LABELS, requireSuper, scopeLabel, type Permission } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const PERMS = Object.keys(PERMISSION_LABELS) as Permission[];
const DESCRIPTIONS: Record<Permission, string> = {
  stores: 'Ajouter et modifier les supermarchés, leurs adresses GPS et leurs directeurs.',
  drivers: 'Ouvrir l’espace livreur, vérifier les dossiers, certifier ou suspendre.',
  support: 'Répondre aux clients sous le nom « ASSISTANT (ville) » et aux fils internes des magasins.',
  finance: 'Preuves de paiement, finances, budgets, rapports et exports.',
  users: 'Gérer les comptes clients et livreurs (rôle, activation).',
  marketing: 'Coupons, promotions, bannières (photo ou vidéo) et partenaires.',
};
const ERRORS: Record<string, string> = {
  USER_NOT_FOUND: 'Aucun compte avec cet e-mail.',
  ROLE_CONFLICT: 'Ce compte est déjà livreur, directeur ou administrateur : utilisez un autre e-mail.',
  PERMISSIONS_REQUIRED: 'Cochez au moins une mission.',
  SELF_GRANT: 'Vous êtes déjà administrateur général.',
  WEAK_PASSWORD: 'Mot de passe provisoire : 10 caractères minimum.',
  INVALID_EMAIL: 'Adresse e-mail invalide.',
};

function region(f: FormData) {
  return {
    province: String(f.get('province') ?? '').trim() || null,
    city: String(f.get('city') ?? '').trim() || null,
    commune: String(f.get('commune') ?? '').trim() || null,
  };
}
const back = (q: string) => redirect(`/admin/agents?${q}`);

// Nouveau compte agent (connexion créée par la fonction serveur « staff-create »).
async function createAgent(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const { data: s } = await sb.auth.getSession();
  const permissions = PERMS.filter((p) => f.get(`perm_${p}`) === 'on');
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/staff-create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.session?.access_token ?? ''}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({
      email: String(f.get('email') ?? ''), password: String(f.get('password') ?? ''),
      full_name: String(f.get('full_name') ?? ''), phone: String(f.get('phone') ?? ''), permissions, ...region(f),
    }),
  });
  const json = await res.json().catch(() => ({}));
  revalidatePath('/admin/agents');
  if (!res.ok) back('err=' + encodeURIComponent(ERRORS[json.error] ?? json.detail ?? json.error ?? 'Création impossible'));
  back('ok=' + encodeURIComponent(json.created ? 'Agent créé : communiquez-lui son e-mail et son mot de passe provisoire.' : 'Accès ajoutés au compte existant.'));
}

async function grant(f: FormData) {
  'use server';
  const sb = await supabaseServer();
  const permissions = PERMS.filter((p) => f.get(`perm_${p}`) === 'on');
  const r = region(f);
  const { error } = await sb.rpc('staff_grant', {
    p_email: String(f.get('email') ?? ''), p_permissions: permissions, p_province: r.province, p_city: r.city, p_commune: r.commune,
  });
  revalidatePath('/admin/agents');
  back(error ? 'err=' + encodeURIComponent(ERRORS[error.message] ?? error.message) : 'ok=Accès attribués');
}

async function revoke(f: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('staff_revoke', { p_permission_id: String(f.get('id')) });
  revalidatePath('/admin/agents');
  back(error ? 'err=' + encodeURIComponent(error.message) : 'ok=Accès retiré');
}

async function setActive(f: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('staff_set_user_role', { p_user_id: String(f.get('id')), p_role: 'agent', p_active: f.get('active') === '1' });
  revalidatePath('/admin/agents');
  back(error ? 'err=' + encodeURIComponent(error.message) : 'ok=Compte mis à jour');
}

function PermissionPicker() {
  return (
    <div className="cols">
      {PERMS.map((p) => (
        <label key={p} className="check" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" name={`perm_${p}`} style={{ marginTop: 3 }} />
          <span><b>{PERMISSION_LABELS[p]}</b><br /><span className="muted" style={{ fontSize: 13 }}>{DESCRIPTIONS[p]}</span></span>
        </label>
      ))}
    </div>
  );
}

function RegionFields() {
  return (
    <div className="cols">
      <label>Province (vide = toutes)<input name="province" placeholder="Kinshasa" /></label>
      <label>Ville (vide = toutes)<input name="city" placeholder="Kinshasa" /></label>
      <label>Commune (vide = toutes)<input name="commune" placeholder="Limete" /></label>
    </div>
  );
}

export default async function Agents({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireSuper();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: agents } = await sb.from('profiles').select('id, full_name, email, phone, is_active, created_at')
    .eq('role', 'agent').order('full_name');
  const ids = (agents ?? []).map((a) => a.id);
  const { data: perms } = ids.length
    ? await sb.from('staff_permissions').select('id, user_id, permission, province, city, commune, created_at').in('user_id', ids).is('revoked_at', null).order('created_at')
    : { data: [] };
  const byUser = new Map<string, any[]>();
  for (const p of perms ?? []) byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p]);

  return (
    <>
      <h1>Agents et accès</h1>
      <p className="page-sub">Les agents de la Direction travaillent sur l&apos;espace web avec uniquement les missions et la région que vous leur attribuez. Tout est enregistré au journal d&apos;audit.</p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="dash">
        <div className="card span-6">
          <div className="card-title">Créer un agent</div>
          <form action={createAgent} className="stack">
            <div className="cols">
              <label>Nom complet<input name="full_name" required /></label>
              <label>Téléphone<input name="phone" placeholder="+243…" /></label>
              <label>Adresse e-mail<input name="email" type="email" required /></label>
              <label>Mot de passe provisoire (10 caractères min.)<input name="password" type="text" minLength={10} required autoComplete="off" /></label>
            </div>
            <PermissionPicker />
            <RegionFields />
            <button type="submit">Créer le compte agent</button>
          </form>
        </div>
        <div className="card span-6">
          <div className="card-title">Donner des accès à un compte existant</div>
          <form action={grant} className="stack">
            <label>E-mail du compte (créé dans l&apos;application)<input name="email" type="email" required /></label>
            <PermissionPicker />
            <RegionFields />
            <button type="submit">Attribuer les accès</button>
          </form>
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>Agents ({agents?.length ?? 0})</h2>
      {!agents?.length ? <p className="muted">Aucun agent pour le moment.</p> : null}
      <div className="grid">
        {(agents ?? []).map((a) => (
          <div key={a.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{a.full_name ?? a.email}</b> {a.is_active ? <span className="badge ok">actif</span> : <span className="badge bad">désactivé</span>}
                <div className="muted" style={{ fontSize: 13 }}>{a.email}{a.phone ? ` · ${a.phone}` : ''} · depuis le {dateTime(a.created_at)}</div>
              </div>
              <form action={setActive}>
                <input type="hidden" name="id" value={a.id} /><input type="hidden" name="active" value={a.is_active ? '0' : '1'} />
                <button className="secondary">{a.is_active ? 'Désactiver' : 'Réactiver'}</button>
              </form>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {(byUser.get(a.id) ?? []).map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-alt)', borderRadius: 10, padding: '8px 10px' }}>
                  <div>
                    <b>{PERMISSION_LABELS[p.permission as Permission]}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{scopeLabel(p)}</div>
                  </div>
                  <form action={revoke}><input type="hidden" name="id" value={p.id} /><button className="secondary">Retirer</button></form>
                </div>
              ))}
              {!(byUser.get(a.id) ?? []).length ? <span className="muted">Aucun accès actif.</span> : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
