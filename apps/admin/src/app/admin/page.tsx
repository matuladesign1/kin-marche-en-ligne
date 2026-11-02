import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { dateTime, PAY_FR, STATUS_FR, usd } from '@/lib/format';

export default async function AdminHome() {
  const sb = await supabaseServer();
  const count = async (table: string, f?: (q: any) => any) => {
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    if (f) q = f(q);
    return (await q).count ?? 0;
  };
  const [stores, customers, managers, drivers, pendingDrivers, paidOrders, pendingOrders] = await Promise.all([
    count('stores'),
    count('profiles', (q) => q.eq('role', 'customer')),
    count('profiles', (q) => q.eq('role', 'store_admin')),
    count('drivers', (q) => q.eq('status', 'verified')),
    count('drivers', (q) => q.eq('status', 'pending_review')),
    count('orders', (q) => q.eq('payment_status', 'succeeded')),
    count('orders', (q) => q.eq('payment_status', 'pending')),
  ]);
  const { data: sales } = await sb.from('financial_ledger').select('amount_usd').eq('entry_type', 'sale');
  const total = (sales ?? []).reduce((s, r) => s + Number(r.amount_usd), 0);
  const { data: recent } = await sb.from('orders').select('id, order_number, status, payment_status, total_usd, created_at, stores(name)').order('created_at', { ascending: false }).limit(10);

  return (
    <>
      <h1>Tableau de bord général</h1>
      <div className="grid">
        <div className="card stat"><div className="v">{usd(total)}</div><div className="l">Ventes confirmées (paiements réels)</div></div>
        <div className="card stat"><div className="v">{paidOrders}</div><div className="l">Commandes payées</div></div>
        <div className="card stat"><div className="v">{pendingOrders}</div><div className="l">Commandes en attente de paiement</div></div>
        <div className="card stat"><div className="v">{stores}</div><div className="l">Supermarchés</div></div>
        <div className="card stat"><div className="v">{customers}</div><div className="l">Clients</div></div>
        <div className="card stat"><div className="v">{managers}</div><div className="l">Directeurs / gestionnaires</div></div>
        <div className="card stat"><div className="v">{drivers}</div><div className="l">Livreurs vérifiés</div></div>
        <div className="card stat"><div className="v">{pendingDrivers}</div><div className="l">Livreurs à vérifier</div></div>
      </div>
      {stores === 0 ? (
        <div className="notice">Aucun supermarché enregistré. <Link href="/admin/magasins">Ajoutez les magasins officiels</Link> (saisie ou import CSV) pour ouvrir le catalogue aux clients.</div>
      ) : null}
      <h2>Dernières commandes</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>N°</th><th>Magasin</th><th>Statut</th><th>Paiement</th><th>Total</th><th>Date</th></tr></thead>
          <tbody>
            {(recent ?? []).map((o: any) => (
              <tr key={o.id}><td>{o.order_number}</td><td>{o.stores?.name}</td><td>{STATUS_FR[o.status]}</td><td>{PAY_FR[o.payment_status]}</td><td>{usd(o.total_usd)}</td><td>{dateTime(o.created_at)}</td></tr>
            ))}
            {!recent?.length ? <tr><td colSpan={6} className="muted">Aucune commande pour le moment.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
