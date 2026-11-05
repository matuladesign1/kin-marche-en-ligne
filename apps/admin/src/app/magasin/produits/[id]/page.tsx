import { Flash } from '@/components/Shell';
import { supabaseServer } from '@/lib/supabase-server';
import { deleteImage, removeFromStore, updateProduct } from '../actions';
import { ProductForm } from '../ProductForm';

export default async function Produit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: inv } = await sb.from('store_inventory').select('*, stores(name)').eq('id', id).maybeSingle();
  if (!inv) return <h1>Produit introuvable</h1>;
  const [{ data: product }, { data: categories }, { data: images }] = await Promise.all([
    sb.from('products').select('*').eq('id', inv.product_id).single(),
    sb.from('product_categories').select('id, name').order('sort_order'),
    sb.from('product_images').select('id, url').eq('product_id', inv.product_id).order('sort_order'),
  ]);
  return (
    <>
      <h1>{product?.name}</h1>
      <p className="muted">{(inv as any).stores?.name} · vendu {inv.sold_count} fois</p>
      <Flash ok={sp.ok} err={sp.err} />
      {images?.length ? (
        <div className="row" style={{ marginBottom: 12 }}>
          {images.map((im) => (
            <form key={im.id} action={deleteImage} className="card" style={{ padding: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
              <input type="hidden" name="image_id" value={im.id} /><input type="hidden" name="inventory_id" value={id} />
              <button className="secondary" style={{ marginTop: 6, width: '100%' }}>Retirer</button>
            </form>
          ))}
        </div>
      ) : null}
      <form action={updateProduct} className="stack card">
        <input type="hidden" name="inventory_id" value={id} /><input type="hidden" name="product_id" value={inv.product_id} />
        <ProductForm categories={(categories ?? []) as any} product={product} inventory={inv} />
        <div><button type="submit">Enregistrer</button></div>
      </form>
      <h2>Retirer du magasin</h2>
      <form action={removeFromStore} className="row">
        <input type="hidden" name="inventory_id" value={id} />
        <button className="danger">Retirer ce produit du catalogue de ce magasin</button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Pour une rupture temporaire, décochez plutôt « Disponible à la vente ». Les commandes passées restent intactes.</p>
    </>
  );
}
