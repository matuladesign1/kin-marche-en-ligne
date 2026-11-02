import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const ROLES: Record<string, string> = {
  customer: 'Client', store_admin: 'Admin magasin', driver: 'Livreur', super_admin: 'Administrateur général',
};

async function updateUser(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const id = String(formData.get('id'));
  const role = String(formData.get('role'));
  const active = formData.get('active') === 'on';
  const q = String(formData.get('q') ?? '');
  const { error } = await sb.from('profiles').update({ role, is_active: active }).eq('id', id);
  // Un livreur doit avoir sa fiche (statut « à vérifier ») pour être certifié ensuite.
  if (!error && role === 'driver') await sb.from('drivers').upsert({ id }, { onConflict: 'id', ignoreDuplicates: true });
  revalidatePath('/admin/utilisateurs');
  redirect(`/admin/utilisateurs?q=${encodeURIComponent(q)}&${error ? 'err=' + encodeURIComponent(error.message) : 'ok=Compte mis à jour'}`);
}

export default async function Utilisateurs({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const sb = await supabaseServer();
  let query = sb.from('profiles').select('id, full_name, email, phone, role, is_active, created_at').order('created_at', { ascending: false }).limit(50);
  if (q) query = query.or(`email.ilike.%${q.replace(/[%,()]/g, '')}%,full_name.ilike.%${q.replace(/[%,()]/g, '')}%,phone.ilike.%${q.replace(/[%,()]/g, '')}%`);
  const { data: users } = await query;
  return (
    <>
      <h1>Utilisateurs et rôles</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="notice">
        Pour créer un directeur, un gestionnaire ou un livreur : la personne crée d&apos;abord son compte dans l&apos;application,
        puis vous lui attribuez son rôle ici. Pour un directeur, ajoutez-le aussi à son magasin (page du magasin).
        Tout changement de rôle est enregistré dans le journal d&apos;audit.
      </div>
      <form className="row" style={{ marginBottom: 12 }}>
        <label>Rechercher (e-mail, nom, téléphone)<input name="q" defaultValue={q} /></label>
        <button type="submit">Rechercher</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>E-mail</th><th>Téléphone</th><th>Inscrit le</th><th>Rôle et accès</th></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td><td>{u.email}</td><td>{u.phone}</td><td>{dateTime(u.created_at)}</td>
                <td>
                  <form action={updateUser} className="row">
                    <input type="hidden" name="id" value={u.id} /><input type="hidden" name="q" value={q} />
                    <select name="role" defaultValue={u.role}>
                      {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="active" defaultChecked={u.is_active} /> actif</label>
                    <button className="secondary">Enregistrer</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
