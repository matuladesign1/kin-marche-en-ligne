import { Icon } from '@/components/icons';
import { markPendingAction, markSentAction, markSkippedAction, noAction } from '@/components/loyalty/actions';
import { LoyaltyHeader, TierBadge } from '@/components/loyalty/LoyaltyAdmin';
import { SelectAll } from '@/components/loyalty/SelectAll';
import { Flash } from '@/components/Shell';
import { requireSuper } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { SYNC_KIND_FR, loyaltyError, points } from '@/lib/loyalty';
import { supabaseServer } from '@/lib/supabase-server';

const FILTERS: Record<string, string> = { pending: 'À reporter', sent: 'Saisies', skipped: 'Ignorées' };
const TX_TYPE_FR: Record<string, string> = { earn: 'gagnés', redeem: 'utilisés', adjust: 'ajustement', refund_reversal: 'retirés (annulation)', expire: 'expirés' };

// Opérations faites dans l'application à reporter dans l'espace Kin Marché Fidélité,
// tant que le programme n'offre pas d'accès API (alors un connecteur les enverra seul).
export default async function Operations({ searchParams }: { searchParams: Promise<{ f?: string; ok?: string; err?: string }> }) {
  await requireSuper();
  const sp = await searchParams;
  const f = sp.f && sp.f in FILTERS ? sp.f : 'pending';
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('admin_loyalty_sync_queue', { p_status: f, p_limit: 500 });
  const rows = (data?.rows ?? []) as any[];
  const counts = (data?.counts ?? {}) as Record<string, number>;

  return (
    <>
      <LoyaltyHeader base="/admin/fidelite" current="ops" isSuper />
      <Flash ok={sp.ok} err={sp.err} />
      {error ? <div className="notice err">{loyaltyError(error.message)}</div> : null}
      <p className="muted" style={{ marginTop: 0 }}>
        Nouvelles cartes, points gagnés ou utilisés, changements de niveau et suspensions faits dans l&apos;application.
        Reportez-les dans l&apos;espace Kin Marché Fidélité pour que la carte en magasin affiche le même solde, puis marquez-les comme saisies.
      </p>
      <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
        {Object.entries(FILTERS).map(([k, v]) => (
          <a key={k} className={`btn ${k === f ? '' : 'secondary'}`} href={`/admin/fidelite/operations?f=${k}`}>{v} ({counts[k] ?? 0})</a>
        ))}
        <a className="btn secondary" href={`/admin/fidelite/operations/export?f=${f}`} style={{ marginLeft: 'auto' }}><Icon name="download" /> Télécharger (CSV)</a>
      </div>

      <form action={noAction}>
        <input type="hidden" name="f" value={f} />
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 32 }}><SelectAll /></th><th>Date</th><th>Opération</th><th>Carte</th><th>Client</th><th style={{ textAlign: 'right' }}>Points</th><th>Niveau</th><th>Référence</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" name="ids" value={r.id} aria-label={`Opération ${r.id}`} /></td>
                  <td>{dateTime(r.created_at)}</td>
                  <td>{SYNC_KIND_FR[r.kind] ?? r.kind}{r.kind === 'points' && r.details?.type ? <span className="muted"> · {TX_TYPE_FR[r.details.type] ?? r.details.type}</span> : null}
                    {r.kind === 'status' ? <span className="muted"> · {r.card_status === 'suspended' ? 'suspendue' : 'active'}</span> : null}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '.05em' }}>{r.card_number}</td>
                  <td>{r.full_name ?? r.details?.full_name ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: r.points > 0 ? 'var(--success)' : r.points < 0 ? 'var(--danger)' : undefined }}>
                    {r.points ? `${r.points > 0 ? '+' : ''}${points(r.points)}` : ''}</td>
                  <td>{r.tier ? <TierBadge tier={r.tier} /> : null}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{r.reference ?? ''}{r.details?.note && r.kind !== 'points' ? ` · ${r.details.note}` : ''}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={8} className="muted">Aucune opération.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {rows.length ? (
          <div className="row" style={{ marginTop: 12 }}>
            {f !== 'sent' ? <button formAction={markSentAction}><Icon name="check" /> Marquer comme saisies</button> : null}
            {f === 'pending' ? <button formAction={markSkippedAction} className="secondary">Ignorer</button> : null}
            {f !== 'pending' ? <button formAction={markPendingAction} className="secondary">Remettre à reporter</button> : null}
          </div>
        ) : null}
      </form>
    </>
  );
}
