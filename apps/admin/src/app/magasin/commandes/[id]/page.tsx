import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { deferGiftAction } from '@/components/wheel/actions';
import { dateTime, PAY_FR, STATUS_FR, STORE_NEXT, UNIT_FR, usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

async function advance(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const sb = await supabaseServer();
  const { error } = await sb.rpc('advance_order_status', { p_order_id: id, p_status: String(formData.get('to')), p_note: String(formData.get('note') ?? '') || null });
  revalidatePath(`/magasin/commandes/${id}`);
  redirect(`/magasin/commandes/${id}?${error ? 'err=' + encodeURIComponent(error.message) : 'ok=Statut mis à jour'}`);
}

async function markItem(formData: FormData) {
  'use server';
  const id = String(formData.get('order_id'));
  const sb = await supabaseServer();
  // Signalement d'un produit manquant : enregistré comme incident pour l'assistance.
  const { data: u } = await sb.auth.getUser();
  await sb.from('delivery_incidents').insert({
    order_id: id, reported_by: u.user!.id, type: 'missing_item', description: `Produit manquant : ${String(formData.get('name'))}`,
  });
  redirect(`/magasin/commandes/${id}?ok=Produit manquant signalé à l'assistance`);
}

async function callDriver(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('assign_next_driver', { p_order_id: id });
  revalidatePath(`/magasin/commandes/${id}`);
  redirect(`/magasin/commandes/${id}?${error ? 'err=' + encodeURIComponent(error.message) : data ? 'ok=Mission proposée à un livreur' : 'err=Aucun livreur vérifié disponible pour le moment'}`);
}

export default async function Commande({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: o }, { data: items }, { data: track }, { data: incidents }, { data: gifts }] = await Promise.all([
    sb.from('orders').select('*').eq('id', id).maybeSingle(),
    sb.from('order_items').select('*').eq('order_id', id),
    sb.rpc('get_order_tracking', { p_order_id: id }),
    sb.from('delivery_incidents').select('type, description, created_at, resolved').eq('order_id', id),
    // Cadeaux gagnés à la Roue de la chance, joints gratuitement à cette commande.
    sb.from('wheel_rewards').select('id, label, quantity, claim_code, products(name)').eq('order_id', id).eq('status', 'attached'),
  ]);
  if (!o) return <h1>Commande introuvable</h1>;
  const a = o.delivery_address ?? {};
  const next = STORE_NEXT[o.status];
  const t = track as any;

  return (
    <>
      <h1>Commande {o.order_number}</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid">
        <div className="card"><div className="muted">Statut</div><b>{STATUS_FR[o.status]}</b></div>
        <div className="card"><div className="muted">Paiement</div><b>{PAY_FR[o.payment_status]}</b>{o.paid_at ? <div className="muted">{dateTime(o.paid_at)}</div> : null}</div>
        <div className="card"><div className="muted">Total</div><b>{usd(o.total_usd)}</b></div>
        <div className="card"><div className="muted">Code colis</div><b style={{ letterSpacing: 2 }}>{o.package_code}</b><div className="muted" style={{ fontSize: 12 }}>À coller sur le colis : le livreur doit le scanner</div></div>
      </div>

      {next && o.payment_status === 'succeeded' ? (
        <form action={advance} className="card row" style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={o.id} /><input type="hidden" name="to" value={next.to} />
          <label>Note (facultatif)<input name="note" /></label>
          <button type="submit">{next.label}</button>
        </form>
      ) : null}
      {o.status === 'ready' && !t?.assignment ? (
        <form action={callDriver} className="row" style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={o.id} />
          <button className="secondary">Relancer la recherche de livreur</button>
        </form>
      ) : null}

      <h2>Articles à préparer</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Produit</th><th>Quantité</th><th>Prix unitaire</th><th>Total</th><th></th></tr></thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id}>
                <td>{i.product_name}</td><td>{Number(i.quantity)} {UNIT_FR[i.unit]}</td><td>{usd(i.unit_price_usd)}</td><td>{usd(i.line_total_usd)}</td>
                <td>
                  {['sent_to_store', 'preparing', 'verified'].includes(o.status) ? (
                    <form action={markItem}><input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="name" value={i.product_name} /><button className="secondary">Signaler manquant</button></form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {gifts?.length ? (
        <>
          <h2>Cadeaux Roue de la chance à joindre</h2>
          <div className="card stack">
            <p className="muted" style={{ margin: 0 }}>Gagnés par le client : à ajouter gratuitement au colis (aucun montant à encaisser).</p>
            {gifts.map((g: any) => (
              <div key={g.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div><b>{g.quantity} × {g.products?.name ?? g.label}</b> <span className="muted">· {g.label} · code cadeau {g.claim_code}</span></div>
                {['sent_to_store', 'preparing', 'verified', 'packed'].includes(o.status) ? (
                  <form action={deferGiftAction} className="row">
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="order_id" value={o.id} />
                    <button className="secondary">Indisponible : reporter à la commande suivante</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2>Livraison</h2>
      <div className="card">
        <div><b>{a.recipient_name}</b> — {a.recipient_phone}</div>
        <div>{[a.avenue, a.street_number, a.quartier, a.commune, a.city].filter(Boolean).join(', ')}</div>
        {a.landmark ? <div className="muted">{a.landmark}</div> : null}
        {o.delivery_instructions ? <div className="notice">{o.delivery_instructions}</div> : null}
        {t?.driver ? <div style={{ marginTop: 8 }}>Livreur : <b>{t.driver.name}</b> ({t.driver.driver_code}) {t.driver.phone ? `— ${t.driver.phone}` : ''}</div> : null}
      </div>

      {incidents?.length ? (
        <>
          <h2>Incidents</h2>
          <div className="card">{incidents.map((x, k) => <div key={k}>{dateTime(x.created_at)} — {x.description} {x.resolved ? '✓' : ''}</div>)}</div>
        </>
      ) : null}

      <h2>Historique</h2>
      <div className="card">{(t?.history ?? []).map((h: any, k: number) => <div key={k}>{dateTime(h.at)} — {STATUS_FR[h.status]}{h.note ? ` (${h.note})` : ''}</div>)}</div>
    </>
  );
}
