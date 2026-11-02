import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { dateTime, PAY_FR, STATUS_FR, usd } from '@/lib/format';
import { currentStore } from '@/lib/store';
import { supabaseServer } from '@/lib/supabase-server';
import { StorePicker } from '../StorePicker';

const FILTERS: Record<string, { label: string; statuses: string[] | null }> = {
  todo: { label: 'À traiter', statuses: ['sent_to_store', 'preparing', 'verified', 'packed'] },
  ready: { label: 'Prêtes / livreur', statuses: ['ready', 'driver_assigned', 'driver_to_store'] },
  delivery: { label: 'En livraison', statuses: ['picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'] },
  done: { label: 'Terminées', statuses: ['delivered', 'completed'] },
  unpaid: { label: 'Non payées', statuses: ['received'] },
  cancelled: { label: 'Annulées', statuses: ['cancelled', 'failed', 'refunded'] },
};

export default async function Commandes({ searchParams }: { searchParams: Promise<{ store?: string; f?: string }> }) {
  const sp = await searchParams;
  const user = await requireRole('store_admin');
  const { stores, store } = await currentStore(user.id, sp.store);
  if (!store) return null;
  const f = FILTERS[sp.f ?? 'todo'] ? (sp.f ?? 'todo') : 'todo';
  const sb = await supabaseServer();
  const { data: orders } = await sb.from('orders')
    .select('id, order_number, status, payment_status, total_usd, created_at, delivery_address')
    .eq('store_id', store.id).in('status', FILTERS[f].statuses!).order('created_at', { ascending: f === 'todo' }).limit(100);

  return (
    <>
      <h1>Commandes — {store.name}</h1>
      <StorePicker stores={stores} current={store.id} path="/magasin/commandes" />
      <div className="row" style={{ marginBottom: 12 }}>
        {Object.entries(FILTERS).map(([k, v]) => (
          <Link key={k} className={`btn ${k === f ? '' : 'secondary'}`} href={`/magasin/commandes?store=${store.id}&f=${k}`}>{v.label}</Link>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>N°</th><th>Reçue le</th><th>Commune</th><th>Statut</th><th>Paiement</th><th>Total</th></tr></thead>
          <tbody>
            {(orders ?? []).map((o: any) => (
              <tr key={o.id}>
                <td><Link href={`/magasin/commandes/${o.id}`}>{o.order_number}</Link></td>
                <td>{dateTime(o.created_at)}</td><td>{o.delivery_address?.commune}</td>
                <td>{STATUS_FR[o.status]}</td><td>{PAY_FR[o.payment_status]}</td><td>{usd(o.total_usd)}</td>
              </tr>
            ))}
            {!orders?.length ? <tr><td colSpan={6} className="muted">Aucune commande dans cette catégorie.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {f === 'unpaid' ? <p className="muted" style={{ fontSize: 13 }}>Ne préparez jamais une commande non payée : elle n&apos;apparaît dans « À traiter » qu&apos;après confirmation du paiement par le prestataire.</p> : null}
    </>
  );
}
