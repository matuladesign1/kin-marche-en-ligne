import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { dateTime, usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const METHOD: Record<string, string> = {
  bank_transfer: 'Virement bancaire', mpesa: 'M-Pesa', orange_money: 'Orange Money', airtel_money: 'Airtel Money', afrimoney: 'Afrimoney', other: 'Autre',
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'À vérifier', cls: 'warn' }, approved: { label: 'Acceptée', cls: 'ok' }, rejected: { label: 'Refusée', cls: 'bad' },
};

async function decide(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const approve = formData.get('decision') === 'approve';
  const amount = Number(String(formData.get('amount') ?? '').replace(',', '.'));
  const { error } = await sb.rpc('review_payment_proof', {
    p_proof_id: String(formData.get('id')), p_approve: approve,
    p_amount: approve ? amount : null, p_currency: String(formData.get('currency') ?? 'USD'),
    p_reference: String(formData.get('reference') ?? '') || null, p_note: String(formData.get('note') ?? '') || null,
  });
  revalidatePath('/admin/preuves');
  redirect(`/admin/preuves?${error ? 'err=' + encodeURIComponent(error.message) : 'ok=' + encodeURIComponent(approve ? 'Paiement confirmé après vérification' : 'Preuve refusée, client notifié')}`);
}

export default async function Preuves({ searchParams }: { searchParams: Promise<{ f?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const f = STATUS[sp.f ?? ''] ? sp.f! : 'pending';
  const sb = await supabaseServer();
  const { data: proofs } = await sb.from('payment_proofs')
    .select('id, order_id, storage_path, method, reference, note, status, review_note, created_at, reviewed_at, orders(order_number, total_usd, payment_status, status, stores(name)), profiles!payment_proofs_customer_id_fkey(full_name, email)')
    .eq('status', f).order('created_at', { ascending: f === 'pending' }).limit(100);

  // Bucket privé : liens signés de 10 minutes, réservés à l'administration.
  const paths = (proofs ?? []).map((p: any) => p.storage_path);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await sb.storage.from('payment-proofs').createSignedUrls(paths, 600);
    (data ?? []).forEach((s) => { if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl); });
  }

  return (
    <>
      <h1>Preuves de paiement</h1>
      <p className="muted">Une preuve ne vaut paiement qu&apos;après vérification du montant réellement reçu sur le compte Kin Marché (relevé bancaire ou Mobile Money).</p>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="row" style={{ marginBottom: 12 }}>
        {Object.entries(STATUS).map(([k, v]) => <a key={k} className={`btn ${k === f ? '' : 'secondary'}`} href={`/admin/preuves?f=${k}`}>{v.label}</a>)}
      </div>
      {!proofs?.length ? <p className="muted">Aucune preuve dans cette catégorie.</p> : null}
      {(proofs ?? []).map((p: any) => {
        const url = signed.get(p.storage_path);
        return (
          <div key={p.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <b>{p.orders?.order_number}</b> — {usd(p.orders?.total_usd)} · {p.orders?.stores?.name}
                <span className={`badge ${STATUS[p.status].cls}`} style={{ marginLeft: 8 }}>{STATUS[p.status].label}</span>
                <div className="muted">{p.profiles?.full_name} · {p.profiles?.email} · déposée le {dateTime(p.created_at)}</div>
                <div>{METHOD[p.method] ?? p.method}{p.reference ? ` · Réf. ${p.reference}` : ''}</div>
                {p.note ? <div className="muted">Client : {p.note}</div> : null}
                {p.review_note ? <div className="muted">Décision : {p.review_note}</div> : null}
              </div>
              {url ? (p.storage_path.endsWith('.pdf') ? <a className="btn secondary" href={url} target="_blank" rel="noreferrer">Ouvrir le PDF</a>
                // eslint-disable-next-line @next/next/no-img-element
                : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Preuve" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8 }} /></a>) : null}
            </div>
            {p.status === 'pending' ? (
              <form action={decide} className="row" style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={p.id} />
                <label>Montant reçu <input name="amount" inputMode="decimal" placeholder="ex. 45.50" /></label>
                <label>Devise <select name="currency" defaultValue="USD"><option>USD</option><option>CDF</option><option>EUR</option></select></label>
                <label>Référence vérifiée <input name="reference" defaultValue={p.reference ?? ''} /></label>
                <label>Note au client <input name="note" maxLength={300} /></label>
                <button name="decision" value="approve">Confirmer le paiement</button>
                <button name="decision" value="reject" className="secondary">Refuser</button>
              </form>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
