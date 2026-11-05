import Link from 'next/link';
import { Flash } from '@/components/Shell';
import { requireRole } from '@/lib/auth';
import { UNIT_FR, usd } from '@/lib/format';
import { currentStore } from '@/lib/store';
import { supabaseServer } from '@/lib/supabase-server';
import { StorePicker } from '../StorePicker';
import { quickStock } from './actions';

export default async function Produits({ searchParams }: { searchParams: Promise<{ store?: string; q?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const user = await requireRole('store_admin');
  const { stores, store } = await currentStore(user.id, sp.store);
  if (!store) return null;
  const sb = await supabaseServer();
  const q = (sp.q ?? '').trim().replace(/[%,()]/g, '');
  let query = sb.from('store_inventory')
    .select('id, price_usd, promo_price_usd, stock, low_stock_threshold, is_available, products!inner(name, sku, barcode, unit, is_active)')
    .eq('store_id', store.id).order('updated_at', { ascending: false }).limit(200);
  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.eq.${q}`, { referencedTable: 'products' });
  const { data: rows } = await query;
  const qs = new URLSearchParams({ store: store.id, ...(q ? { q } : {}) }).toString();

  return (
    <>
      <h1>Produits et stock — {store.name}</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <StorePicker stores={stores} current={store.id} path="/magasin/produits" />
      <form className="row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="store" value={store.id} />
        <label>Rechercher (nom, SKU, code-barres)<input name="q" defaultValue={q} /></label>
        <button className="secondary">Rechercher</button>
        <Link className="btn" href={`/magasin/produits/nouveau?store=${store.id}`}>+ Nouveau produit</Link>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Produit</th><th>SKU</th><th>Prix</th><th>Stock rapide</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r: any) => {
              const stock = Number(r.stock);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/magasin/produits/${r.id}`}>{r.products.name}</Link>
                    {!r.products.is_active ? <> <span className="badge">inactif</span></> : null}
                    {stock <= 0 || !r.is_available ? <> <span className="badge bad">épuisé</span></> : stock <= Number(r.low_stock_threshold) ? <> <span className="badge warn">stock faible</span></> : null}
                  </td>
                  <td>{r.products.sku}</td>
                  <td>{usd(r.promo_price_usd ?? r.price_usd)}{r.promo_price_usd ? <span className="muted"> (au lieu de {usd(r.price_usd)})</span> : null} / {UNIT_FR[r.products.unit]}</td>
                  <td>
                    <form action={quickStock} className="row">
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="qs" value={qs} />
                      <input name="stock" defaultValue={stock} style={{ width: 90 }} inputMode="decimal" aria-label="Stock" />
                      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" name="is_available" defaultChecked={r.is_available} /> en vente</label>
                      <button className="secondary">OK</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {!rows?.length ? <tr><td colSpan={4} className="muted">Aucun produit. Ajoutez le premier avec « + Nouveau produit ».</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
