import { Flash } from '@/components/Shell';
import { requirePermission } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';
import { addManager, removeManager, setStoreActive } from '../actions';
import { StoreForm } from '../StoreForm';

export default async function Magasin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requirePermission('stores');
  const { id } = await params;
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: store }, { data: managers }, { data: history }] = await Promise.all([
    sb.from('stores').select('*').eq('id', id).maybeSingle(),
    sb.from('store_managers').select('user_id, title, profiles(full_name, email)').eq('store_id', id),
    sb.from('store_addresses').select('full_text, latitude, longitude, verified, source, created_at').eq('store_id', id).order('created_at', { ascending: false }).limit(10),
  ]);
  if (!store) return <h1>Magasin introuvable</h1>;
  return (
    <>
      <h1>{store.name}</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <StoreForm store={store} />

      <h2>Directeur, gestionnaires et assistants</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>E-mail</th><th>Fonction</th><th></th></tr></thead>
          <tbody>
            {(managers ?? []).map((m: any) => (
              <tr key={m.user_id}>
                <td>{m.profiles?.full_name}</td><td>{m.profiles?.email}</td><td>{m.title}</td>
                <td>
                  <form action={removeManager}>
                    <input type="hidden" name="store_id" value={id} /><input type="hidden" name="user_id" value={m.user_id} />
                    <button className="secondary">Retirer</button>
                  </form>
                </td>
              </tr>
            ))}
            {!managers?.length ? <tr><td colSpan={4} className="muted">Aucun gestionnaire : personne ne peut encore gérer ce magasin.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <form action={addManager} className="card row" style={{ marginTop: 12 }}>
        <input type="hidden" name="store_id" value={id} />
        <label>E-mail du compte (créé dans l&apos;application)<input name="email" type="email" required /></label>
        <label>Fonction
          <select name="title"><option value="directeur">Directeur</option><option value="gestionnaire">Gestionnaire</option><option value="assistant">Assistant</option></select>
        </label>
        <button type="submit">Donner l&apos;accès à ce magasin</button>
      </form>

      <h2>Historique de l&apos;adresse et du GPS</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Adresse</th><th>GPS</th><th>Source</th></tr></thead>
          <tbody>
            {(history ?? []).map((h, i) => (
              <tr key={i}><td>{dateTime(h.created_at)}</td><td>{h.full_text}</td><td>{h.latitude != null ? `${h.latitude}, ${h.longitude}` : '—'}</td><td>{h.source}{h.verified ? ' ✓' : ''}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Activation</h2>
      <form action={setStoreActive} className="row">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={store.is_active ? '0' : '1'} />
        <button className={store.is_active ? 'danger' : ''}>{store.is_active ? 'Désactiver ce magasin' : 'Réactiver ce magasin'}</button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Un magasin désactivé disparaît de l&apos;application client ; ses commandes et son historique financier sont conservés.</p>
    </>
  );
}
