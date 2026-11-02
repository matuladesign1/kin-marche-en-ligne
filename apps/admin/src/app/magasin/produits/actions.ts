'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

const UNITS = ['unit', 'kg', 'g', 'litre', 'ml', 'pack', 'carton'];
const n = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
};
const t = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null;

function productFields(f: FormData) {
  const unit = String(f.get('unit') ?? 'unit');
  return {
    name: String(f.get('name') ?? '').trim(),
    barcode: t(f.get('barcode')),
    description: t(f.get('description')),
    category_id: t(f.get('category_id')),
    brand: t(f.get('brand')),
    unit: UNITS.includes(unit) ? unit : 'unit',
    unit_size: n(f.get('unit_size')),
    min_quantity: n(f.get('min_quantity')) ?? 1,
    quantity_step: n(f.get('quantity_step')) ?? 1,
    weight_kg: n(f.get('weight_kg')),
    allergens: String(f.get('allergens') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    storage_conditions: t(f.get('storage_conditions')),
    has_expiry: f.get('has_expiry') === 'on',
    is_local: f.get('is_local') === 'on',
    is_active: f.get('is_active') !== null ? f.get('is_active') === 'on' : true,
  };
}

function inventoryFields(f: FormData) {
  const promo = n(f.get('promo_price_usd'));
  return {
    price_usd: n(f.get('price_usd')) ?? 0,
    promo_price_usd: promo,
    promo_starts_at: promo ? t(f.get('promo_starts_at')) : null,
    promo_ends_at: promo ? t(f.get('promo_ends_at')) : null,
    stock: Math.max(n(f.get('stock')) ?? 0, 0),
    low_stock_threshold: n(f.get('low_stock_threshold')) ?? 5,
    expiry_date: t(f.get('expiry_date')),
    is_available: f.get('is_available') !== null ? f.get('is_available') === 'on' : true,
  };
}

async function uploadImages(productId: string, files: FormDataEntryValue[]) {
  const sb = await supabaseServer();
  let order = 0;
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
    const path = `${productId}/${Date.now()}-${order}.${file.name.split('.').pop() ?? 'jpg'}`;
    const up = await sb.storage.from('product-media').upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    const url = sb.storage.from('product-media').getPublicUrl(path).data.publicUrl;
    if (file.type.startsWith('video/')) await sb.from('product_videos').insert({ product_id: productId, url, sort_order: order });
    else await sb.from('product_images').insert({ product_id: productId, url, sort_order: order });
    order++;
  }
}

export async function createProduct(formData: FormData) {
  const sb = await supabaseServer();
  const storeId = String(formData.get('store_id'));
  const sku = String(formData.get('sku') ?? '').trim().toUpperCase();
  if (!sku) redirect('/magasin/produits/nouveau?err=Référence SKU obligatoire');
  const p = productFields(formData);
  const inv = inventoryFields(formData);
  if (inv.promo_price_usd != null && inv.promo_price_usd >= inv.price_usd) redirect('/magasin/produits/nouveau?err=Le prix promotionnel doit être inférieur au prix');

  // Le même produit (même SKU) peut être vendu par plusieurs magasins : on le réutilise.
  const { data: existing } = await sb.from('products').select('id').eq('sku', sku).maybeSingle();
  let productId = existing?.id as string | undefined;
  if (!productId) {
    if (!p.name) redirect('/magasin/produits/nouveau?err=Nom obligatoire');
    const { data: u } = await sb.auth.getUser();
    const ins = await sb.from('products').insert({ ...p, sku, created_by: u.user!.id }).select('id').single();
    if (ins.error) redirect(`/magasin/produits/nouveau?err=${encodeURIComponent(ins.error.message)}`);
    productId = ins.data.id;
  }
  const invRes = await sb.from('store_inventory').insert({ ...inv, store_id: storeId, product_id: productId }).select('id').single();
  if (invRes.error) redirect(`/magasin/produits/nouveau?err=${encodeURIComponent(invRes.error.message.includes('duplicate') ? 'Ce produit est déjà dans le catalogue de ce magasin.' : invRes.error.message)}`);
  try {
    await uploadImages(productId!, formData.getAll('media'));
  } catch (e) {
    redirect(`/magasin/produits/${invRes.data.id}?err=${encodeURIComponent('Produit créé, mais l’envoi des photos a échoué : ' + (e as Error).message)}`);
  }
  revalidatePath('/magasin/produits');
  redirect(`/magasin/produits/${invRes.data.id}?ok=${existing ? 'Produit existant ajouté au catalogue du magasin' : 'Produit créé'}`);
}

export async function updateProduct(formData: FormData) {
  const sb = await supabaseServer();
  const invId = String(formData.get('inventory_id'));
  const productId = String(formData.get('product_id'));
  const p = productFields(formData);
  const inv = inventoryFields(formData);
  const back = (q: string) => redirect(`/magasin/produits/${invId}?${q}`);
  if (inv.promo_price_usd != null && inv.promo_price_usd >= inv.price_usd) back('err=Le prix promotionnel doit être inférieur au prix');
  const r1 = await sb.from('products').update(p).eq('id', productId);
  if (r1.error) back('err=' + encodeURIComponent(r1.error.message));
  const r2 = await sb.from('store_inventory').update(inv).eq('id', invId);
  if (r2.error) back('err=' + encodeURIComponent(r2.error.message));
  try {
    await uploadImages(productId, formData.getAll('media'));
  } catch (e) {
    back('err=' + encodeURIComponent((e as Error).message));
  }
  revalidatePath('/magasin/produits');
  back('ok=Enregistré');
}

export async function quickStock(formData: FormData) {
  const sb = await supabaseServer();
  const id = String(formData.get('id'));
  const stock = Math.max(n(formData.get('stock')) ?? 0, 0);
  await sb.from('store_inventory').update({ stock, is_available: formData.get('is_available') === 'on' }).eq('id', id);
  revalidatePath('/magasin/produits');
  redirect(`/magasin/produits?${String(formData.get('qs') ?? '')}`);
}

export async function deleteImage(formData: FormData) {
  const sb = await supabaseServer();
  await sb.from('product_images').delete().eq('id', String(formData.get('image_id')));
  redirect(`/magasin/produits/${String(formData.get('inventory_id'))}?ok=Photo retirée`);
}

export async function removeFromStore(formData: FormData) {
  const sb = await supabaseServer();
  const id = String(formData.get('inventory_id'));
  // On retire le produit du catalogue du magasin ; l'historique des commandes est conservé (lignes figées).
  const { error } = await sb.from('store_inventory').delete().eq('id', id);
  if (error) redirect(`/magasin/produits/${id}?err=${encodeURIComponent(error.message)}`);
  revalidatePath('/magasin/produits');
  redirect('/magasin/produits?ok=Produit retiré du magasin');
}
