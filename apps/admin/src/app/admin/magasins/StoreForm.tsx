import { saveStore } from './actions';

type S = Record<string, any> | null;

export function StoreForm({ store }: { store: S }) {
  const v = (k: string) => (store?.[k] ?? '') as string | number;
  return (
    <form action={saveStore} className="stack card">
      {store ? <input type="hidden" name="id" value={store.id} /> : null}
      <div className="cols">
        <label>Nom officiel *<input name="nom" required defaultValue={v('name')} /></label>
        <label>Code interne<input name="code" defaultValue={v('code')} placeholder="KM-LIM-01" /></label>
        <label>Téléphone<input name="telephone" defaultValue={v('phone')} placeholder="+243…" /></label>
        <label>Province<input name="province" defaultValue={v('province') || 'Kinshasa'} /></label>
        <label>Ville<input name="ville" defaultValue={v('city') || 'Kinshasa'} /></label>
        <label>Commune<input name="commune" defaultValue={v('commune')} /></label>
        <label>Quartier<input name="quartier" defaultValue={v('quartier')} /></label>
        <label>Avenue<input name="avenue" defaultValue={v('avenue')} /></label>
        <label>Numéro<input name="numero" defaultValue={v('street_number')} /></label>
        <label>Référence locale<input name="reference" defaultValue={v('landmark')} /></label>
        <label>Latitude (GPS)<input name="latitude" defaultValue={v('latitude')} placeholder="-4.3…" /></label>
        <label>Longitude (GPS)<input name="longitude" defaultValue={v('longitude')} placeholder="15.3…" /></label>
        <label>Directeur / gestionnaire<input name="directeur" defaultValue={v('manager_name')} /></label>
        <label>Assistant<input name="assistant" defaultValue={v('assistant_name')} /></label>
        <label>Horaires<input name="horaires" defaultValue={store?.opening_hours?.texte ?? ''} placeholder="lun-dim 08:00-21:00" /></label>
        <label>Rayon de livraison (km)<input name="rayon_livraison_km" defaultValue={v('delivery_radius_km') || 5} /></label>
        <label>Frais de livraison fixes (USD)<input name="frais_livraison_usd" defaultValue={v('delivery_fee_usd') || 0} /></label>
        <label>Frais par km (USD)<input name="frais_par_km_usd" defaultValue={v('delivery_fee_per_km_usd') || 0} /></label>
        <label>Commande minimale (USD)<input name="commande_min_usd" defaultValue={v('min_order_usd') || 0} /></label>
        <label>Temps moyen de préparation (min)<input name="temps_preparation_min" defaultValue={v('avg_prep_minutes') || 30} /></label>
        <label>Communes desservies (séparées par ;)<input name="communes_desservies" defaultValue={(store?.delivery_zone ?? []).join('; ')} /></label>
      </div>
      <div className="row">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="ouvert" defaultChecked={store ? store.is_open : true} /> Ouvert</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="adresse_verifiee" defaultChecked={!!store?.address_verified} /> Adresse officielle vérifiée</label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Une adresse n&apos;est enregistrée comme vérifiée que si la commune et les coordonnées GPS sont renseignées ; sinon les clients voient « Adresse à vérifier ».
      </p>
      <div><button type="submit">Enregistrer</button></div>
    </form>
  );
}
