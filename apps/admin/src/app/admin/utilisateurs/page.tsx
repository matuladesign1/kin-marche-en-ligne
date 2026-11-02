import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { requirePermission } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const ROLES: Record<string, string> = {
  customer: 'Client', driver: 'Livreur', store_admin: 'Directeur / gestionnaire', agent: 'Agent', super_admin: 'Administrateur général',
};
const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Action non autorisée pour ce compte ou cette région.',
  USE_AGENTS_PAGE: 'Les agents se créent depuis la page « Agents et accès ».',
  SELF_LOCKOUT: 'Vous ne pouvez pas retirer votre propre accès d’administrateur général.',
};

async function updateUser(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const q = String(formData.get('q') ?? '');
  const { error } = await sb.rpc('staff_set_user_role', {
    p_user_id: String(formData.get('id')), p_role: String(formData.get('role')), p_active: formData.get('active') === 'on',
  });
  revalidatePath('/admin/utilisateurs');
  redirect(`/admin/utilisateurs?q=${encodeURIComponent(q)}&${error ? 'err=' + encodeURIComponent(ERRORS[error.message] ?? error.message) : 'ok=Compte mis à jour'}`);
}

export default async function Utilisateurs({ searchParams }: { searchParams: Promise<{ q?: string; r?: string; ok?: string; err?: string }> }) {
  const user = await requirePermission('users');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const r = sp.r && ROLES[sp.r] ? sp.r : '';
  const sb = await supabaseServer();
  let query = sb.from('profiles').select('id, full_name, email, phone, role, is_active, created_at').order('created_at', { ascending: false }).limit(100);
  // Un agent « rôles » ne gère que les clients et livreurs de sa région (contrôlé aussi par la base).
  if (!user.isSuper) query = query.in('role', ['customer', 'driver']);
  if (r) query = query.eq('role', r);
  if (q) {
    const term = q.replace(/[%,()]/g, '');
    query = query.or(`email.ilike.%${term}%,full_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  const { data: users } = await query;
  const roleOptions = user.isSuper ? ['customer', 'driver', 'store_admin', 'super_admin'] : ['customer', 'driver'];

  return (
    <>
      <h1>Utilisateurs et rôles</h1>
      <p className="page-sub">
        {user.isSuper
          ? 'Tous les comptes. Les directeurs se rattachent à leur magasin depuis la fiche du magasin, les agents depuis « Agents et accès ».'
          : 'Clients et livreurs de votre région : passer un client en livreur, désactiver ou réactiver un compte.'}
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      <form className="card row" style={{ marginBottom: 14 }}>
        <label style={{ flex: 1, minWidth: 240 }}>Rechercher (e-mail, nom, téléphone)<input name="q" defaultValue={q} /></label>
        <label>Rôle
          <select name="r" defaultValue={r}>
            <option value="">Tous</option>
            {Object.entries(ROLES).filter(([k]) => user.isSuper || k === 'customer' || k === 'driver').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <button type="submit">Rechercher</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>E-mail</th><th>Téléphone</th><th>Inscrit le</th><th>Rôle et accès</th></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td><b>{u.full_name}</b>{!u.is_active ? <> <span className="badge bad">désactivé</span></> : null}</td>
                <td>{u.email}</td><td>{u.phone}</td><td>{dateTime(u.created_at)}</td>
                <td>
                  {u.role === 'agent' && user.isSuper ? (
                    <Link className="btn secondary" href="/admin/agents">Gérer les accès de l&apos;agent</Link>
                  ) : (
                    <form action={updateUser} className="row">
                      <input type="hidden" name="id" value={u.id} /><input type="hidden" name="q" value={q} />
                      <select name="role" defaultValue={u.role}>
                        {roleOptions.map((k) => <option key={k} value={k}>{ROLES[k]}</option>)}
                      </select>
                      <label className="check"><input type="checkbox" name="active" defaultChecked={u.is_active} /> actif</label>
                      <button className="secondary">Enregistrer</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!users?.length ? <tr><td colSpan={5} className="muted">Aucun compte trouvé.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
