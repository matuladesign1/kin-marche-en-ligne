import { Icon } from '@/components/icons';
import { importMembersAction } from '@/components/loyalty/actions';
import { LoyaltyHeader } from '@/components/loyalty/LoyaltyAdmin';
import { Flash } from '@/components/Shell';
import { requireSuper } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { loyaltyError, points } from '@/lib/loyalty';
import { supabaseServer } from '@/lib/supabase-server';

// Membres existants de Kin Marché Fidélité : import de l'export du programme en magasin.
// Chaque membre est relié automatiquement au compte de l'application qui porte le même téléphone.
export default async function ImportMembres({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireSuper();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const ov = await sb.rpc('admin_loyalty_overview');
  const o = (ov.data ?? {}) as Record<string, any>;

  return (
    <>
      <LoyaltyHeader base="/admin/fidelite" current="import" isSuper />
      <Flash ok={sp.ok} err={sp.err} />
      {ov.error ? <div className="notice err">{loyaltyError(ov.error.message)}</div> : null}

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="l">Membres importés</div><div className="v">{points(o.program_members)}</div></div>
        <div className="card stat"><div className="l">Reliés à un compte de l&apos;application</div><div className="v">{points(Number(o.program_members ?? 0) - Number(o.program_members_unlinked ?? 0))}</div></div>
        <div className="card stat"><div className="l">Liaisons à vérifier</div><div className="v">{points(o.links_to_verify)}</div></div>
        <div className="card stat"><div className="l">Dernier import</div><div className="v" style={{ fontSize: 18 }}>{o.last_import_at ? dateTime(o.last_import_at) : '—'}</div></div>
      </div>

      <form action={importMembersAction} className="card stack">
        <h2 style={{ margin: 0 }}>Importer la liste des membres</h2>
        <p className="muted" style={{ margin: 0 }}>
          Exportez les membres depuis l&apos;espace Kin Marché Fidélité ({o.settings?.program?.url ?? 'loyalty.kinmarche.com'}) au format CSV,
          ou copiez-les depuis un tableur. Colonnes reconnues : <b>numéro de carte</b> (ou <b>téléphone</b>), <b>nom</b>,{' '}
          <b>niveau</b> (Argent, Gold, Platinum) et <b>points</b>. Sans ligne d&apos;en-tête, l&apos;ordre attendu est : numéro ; nom ; niveau ; points.
        </p>
        <label>Fichier CSV<input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" /></label>
        <label>… ou collez les lignes
          <textarea name="text" rows={8} placeholder={'Numéro de carte;Nom;Niveau;Points\n243812345678;Jean Mukendi;Membre Argent;1250\n243998765432;Marie Kabila;Gold;4300'}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace' }} /></label>
        <div className="row">
          <button type="submit"><Icon name="upload" /> Importer</button>
        </div>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Comment fonctionne la liaison</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>Le numéro de carte est le numéro de téléphone (243 + 9 chiffres). Un membre importé est relié au compte de l&apos;application qui porte le même téléphone, dès maintenant ou à l&apos;inscription du client.</li>
          <li>À la liaison, le client voit sa carte, son niveau et son solde dans l&apos;application. Par sécurité, ces points restent <b>bloqués</b> jusqu&apos;à ce qu&apos;un administrateur vérifie la carte (le téléphone saisi à l&apos;inscription n&apos;est pas vérifié par SMS).</li>
          <li>Réimporter un export plus récent met à jour les membres : l&apos;activité en magasin (points gagnés ou utilisés, changement de niveau) est reportée sur la carte de l&apos;application.</li>
          <li>Les opérations faites dans l&apos;application sont listées dans « Opérations à reporter » : une fois saisies dans l&apos;espace Kin Marché Fidélité, marquez-les comme saisies pour qu&apos;elles ne soient pas comptées deux fois au prochain import.</li>
        </ul>
      </div>
    </>
  );
}
