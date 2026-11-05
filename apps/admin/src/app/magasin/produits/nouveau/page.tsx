import { Flash } from '@/components/Shell';
import { requireRole } from '@/lib/auth';
import { currentStore } from '@/lib/store';
import { supabaseServer } from '@/lib/supabase-server';
import { createProduct } from '../actions';
import { ProductForm } from '../ProductForm';

export default async function NouveauProduit({ searchParams }: { searchParams: Promise<{ store?: string; err?: string }> }) {
  const sp = await searchParams;
  const user = await requireRole('store_admin');
  const { stores, store } = await currentStore(user.id, sp.store);
  if (!store) return null;
  const sb = await supabaseServer();
  const { data: categories } = await sb.from('product_categories').select('id, name').order('sort_order');
  return (
    <>
      <h1>Nouveau produit</h1>
      <Flash err={sp.err} />
      <p className="muted">Si la référence SKU existe déjà (produit vendu par un autre magasin Kin Marché), le produit est simplement ajouté à votre catalogue avec vos prix et votre stock.</p>
      <form action={createProduct} className="stack card">
        <label>Magasin
          <select name="store_id" defaultValue={store.id}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <ProductForm categories={(categories ?? []) as any} />
        <div><button type="submit">Créer le produit</button></div>
      </form>
    </>
  );
}
