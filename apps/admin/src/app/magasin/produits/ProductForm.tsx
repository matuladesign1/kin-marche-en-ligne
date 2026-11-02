import { ProductMediaUpload } from '@/components/ProductMediaUpload';
import { UNIT_FR } from '@/lib/format';

export function ProductForm({ categories, product, inventory }: {
  categories: { id: string; name: { fr?: string } }[];
  product?: Record<string, any> | null;
  inventory?: Record<string, any> | null;
}) {
  const p = product ?? {};
  const i = inventory ?? {};
  const d = (iso?: string | null) => (iso ? iso.slice(0, 16) : '');
  return (
    <>
      <h2>Produit</h2>
      <div className="cols">
        {!product ? <label>Référence SKU *<input name="sku" required placeholder="KM-0001" /></label> : <label>Référence SKU<input value={p.sku} disabled readOnly /></label>}
        <label>Nom *<input name="name" required={!product} defaultValue={p.name ?? ''} /></label>
        <label>Code-barres (EAN)<input name="barcode" defaultValue={p.barcode ?? ''} inputMode="numeric" /></label>
        <label>Marque<input name="brand" defaultValue={p.brand ?? ''} /></label>
        <label>Catégorie
          <select name="category_id" defaultValue={p.category_id ?? ''}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name.fr}</option>)}
          </select>
        </label>
        <label>Unité de vente
          <select name="unit" defaultValue={p.unit ?? 'unit'}>{Object.entries(UNIT_FR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label>Contenance (ex. 1.5 pour 1,5 L)<input name="unit_size" defaultValue={p.unit_size ?? ''} inputMode="decimal" /></label>
        <label>Quantité minimale<input name="min_quantity" defaultValue={p.min_quantity ?? 1} inputMode="decimal" /></label>
        <label>Pas de quantité (ex. 0.5 kg)<input name="quantity_step" defaultValue={p.quantity_step ?? 1} inputMode="decimal" /></label>
        <label>Poids unitaire (kg, pour le livreur)<input name="weight_kg" defaultValue={p.weight_kg ?? ''} inputMode="decimal" /></label>
        <label>Allergènes (séparés par des virgules)<input name="allergens" defaultValue={(p.allergens ?? []).join(', ')} /></label>
        <label>Conservation<input name="storage_conditions" defaultValue={p.storage_conditions ?? ''} /></label>
      </div>
      <label>Description<textarea name="description" rows={3} defaultValue={p.description ?? ''} /></label>
      <div className="row">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="is_local" defaultChecked={!!p.is_local} /> Produit local</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="has_expiry" defaultChecked={!!p.has_expiry} /> Périssable</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="is_active" defaultChecked={product ? p.is_active : true} /> Actif</label>
      </div>

      <h2>Prix et stock dans ce magasin</h2>
      <div className="cols">
        <label>Prix (USD) *<input name="price_usd" required defaultValue={i.price_usd ?? ''} inputMode="decimal" /></label>
        <label>Prix promotionnel (USD)<input name="promo_price_usd" defaultValue={i.promo_price_usd ?? ''} inputMode="decimal" /></label>
        <label>Début de promo<input type="datetime-local" name="promo_starts_at" defaultValue={d(i.promo_starts_at)} /></label>
        <label>Fin de promo<input type="datetime-local" name="promo_ends_at" defaultValue={d(i.promo_ends_at)} /></label>
        <label>Stock disponible *<input name="stock" required defaultValue={i.stock ?? 0} inputMode="decimal" /></label>
        <label>Seuil d&apos;alerte stock faible<input name="low_stock_threshold" defaultValue={i.low_stock_threshold ?? 5} inputMode="decimal" /></label>
        <label>Date d&apos;expiration du lot<input type="date" name="expiry_date" defaultValue={i.expiry_date ?? ''} /></label>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="is_available" defaultChecked={inventory ? i.is_available : true} /> Disponible à la vente (décocher = marqué épuisé)</label>

      <h2>Photos et vidéos</h2>
      <ProductMediaUpload />
    </>
  );
}
