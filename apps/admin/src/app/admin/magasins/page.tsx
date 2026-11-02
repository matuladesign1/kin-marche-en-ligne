import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { Flash } from '@/components/Shell';
import { supabaseServer } from '@/lib/supabase-server';
import { importStores } from './actions';
import { StoreForm } from './StoreForm';

export default async function Magasins({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requirePermission('stores');
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: stores } = await sb.from('stores').select('id, name, commune, quartier, phone, is_open, is_active, address_verified, latitude').order('name');
  return (
    <>
      <h1>Supermarchés</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Commune</th><th>Téléphone</th><th>Adresse</th><th>Statut</th></tr></thead>
          <tbody>
            {(stores ?? []).map((s) => (
              <tr key={s.id}>
                <td><Link href={`/admin/magasins/${s.id}`}>{s.name}</Link></td>
                <td>{[s.commune, s.quartier].filter(Boolean).join(', ')}</td>
                <td>{s.phone}</td>
                <td>{s.address_verified ? <span className="badge ok">Vérifiée</span> : <span className="badge warn">À vérifier</span>}</td>
                <td>{!s.is_active ? <span className="badge bad">Désactivé</span> : s.is_open ? <span className="badge ok">Ouvert</span> : <span className="badge">Fermé</span>}</td>
              </tr>
            ))}
            {!stores?.length ? <tr><td colSpan={5} className="muted">Aucun magasin.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Importer depuis un fichier CSV</h2>
      <form action={importStores} className="card row">
        <label>Fichier CSV (modèle : docs/modele_import_magasins.csv)<input type="file" name="fichier" accept=".csv,text/csv" required /></label>
        <button type="submit">Importer</button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Les lignes avec un « code » déjà existant mettent à jour le magasin correspondant. Excel : « Enregistrer sous → CSV UTF-8 ».</p>

      <h2>Ajouter un magasin</h2>
      <StoreForm store={null} />
    </>
  );
}
