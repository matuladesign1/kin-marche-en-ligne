import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { STATUS_FR, usd } from '@/lib/format';
import { currentStore } from '@/lib/store';
import { supabaseServer } from '@/lib/supabase-server';
import { StorePicker } from './StorePicker';

export default async function StoreHome({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const user = await requireRole('store_admin');
  const { stores, store } = await currentStore(user.id, (await searchParams).store);
  if (!store) return null;
  const sb = await supabaseServer();
  const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

  const [{ data: orders }, { data: inv }, { data: items }] = await Promise.all([
    sb.from('orders').select('status, payment_status, total_usd, paid_at').eq('store_id', store.id).gte('created_at', since(31)),
    sb.from('store_inventory').select('id, stock, low_stock_threshold, is_available, products(name)').eq('store_id', store.id),
    sb.from('order_items').select('product_name, quantity, orders!inner(store_id, payment_status, paid_at)')
      .eq('orders.store_id', store.id).eq('orders.payment_status', 'succeeded').gte('orders.paid_at', since(31)),
  ]);
  const paid = (orders ?? []).filter((o) => o.payment_status === 'succeeded');
  const revenue = (d: number) => paid.filter((o) => o.paid_at && o.paid_at >= since(d)).reduce((s, o) => s + Number(o.total_usd), 0);
  const byStatus = (st: string[]) => (orders ?? []).filter((o) => st.includes(o.status)).length;
  const outOfStock = (inv ?? []).filter((i) => Number(i.stock) <= 0 || !i.is_available);
  const low = (inv ?? []).filter((i) => Number(i.stock) > 0 && Number(i.stock) <= Number(i.low_stock_threshold));
  const top = Object.entries((items ?? []).reduce<Record<string, number>>((acc, i: any) => {
    acc[i.product_name] = (acc[i.product_name] ?? 0) + Number(i.quantity);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <>
      <h1>{store.name}</h1>
      <StorePicker stores={stores} current={store.id} path="/magasin" />
      <div className="grid">
        <div className="card stat"><div className="v">{usd(revenue(1))}</div><div className="l">Chiffre d&apos;affaires 24 h (payé)</div></div>
        <div className="card stat"><div className="v">{usd(revenue(7))}</div><div className="l">7 jours</div></div>
        <div className="card stat"><div className="v">{usd(revenue(30))}</div><div className="l">30 jours</div></div>
        <div className="card stat"><div className="v">{byStatus(['sent_to_store'])}</div><div className="l">À préparer</div></div>
        <div className="card stat"><div className="v">{byStatus(['preparing', 'verified', 'packed'])}</div><div className="l">En préparation</div></div>
        <div className="card stat"><div className="v">{byStatus(['ready', 'driver_assigned', 'driver_to_store'])}</div><div className="l">Prêtes / en attente du livreur</div></div>
        <div className="card stat"><div className="v">{byStatus(['picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'])}</div><div className="l">En livraison</div></div>
        <div className="card stat"><div className="v">{byStatus(['completed'])}</div><div className="l">Terminées (30 j)</div></div>
        <div className="card stat"><div className="v">{byStatus(['cancelled'])}</div><div className="l">Annulées (30 j)</div></div>
      </div>

      <h2>Produits les plus vendus (30 jours)</h2>
      <div className="card">{top.length ? top.map(([n, q]) => <div key={n}>{n} — <b>{q}</b></div>) : <span className="muted">Pas encore de ventes payées.</span>}</div>

      <h2>Alertes de stock</h2>
      <div className="card">
        {outOfStock.length + low.length === 0 ? <span className="muted">Aucune alerte.</span> : null}
        {outOfStock.map((i: any) => <div key={i.id}><span className="badge bad">Épuisé</span> <Link href={`/magasin/produits/${i.id}`}>{i.products?.name}</Link></div>)}
        {low.map((i: any) => <div key={i.id}><span className="badge warn">Stock faible ({Number(i.stock)})</span> <Link href={`/magasin/produits/${i.id}`}>{i.products?.name}</Link></div>)}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Statuts : {Object.values(STATUS_FR).slice(0, 3).join(' → ')} … Seules les commandes réellement payées comptent dans le chiffre d&apos;affaires.</p>
    </>
  );
}
