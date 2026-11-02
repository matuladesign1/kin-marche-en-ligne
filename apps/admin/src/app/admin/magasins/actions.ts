'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null;
const list = (v: FormDataEntryValue | null) => String(v ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);

function storeFromForm(f: FormData) {
  const zone = list(f.get('communes_desservies'));
  return {
    code: txt(f.get('code')),
    name: String(f.get('nom') ?? '').trim(),
    province: txt(f.get('province')),
    city: txt(f.get('ville')),
    commune: txt(f.get('commune')),
    quartier: txt(f.get('quartier')),
    avenue: txt(f.get('avenue')),
    street_number: txt(f.get('numero')),
    landmark: txt(f.get('reference')),
    latitude: num(f.get('latitude')),
    longitude: num(f.get('longitude')),
    phone: txt(f.get('telephone')),
    manager_name: txt(f.get('directeur')),
    assistant_name: txt(f.get('assistant')),
    opening_hours: txt(f.get('horaires')) ? { texte: txt(f.get('horaires')) } : {},
    delivery_radius_km: num(f.get('rayon_livraison_km')) ?? 5,
    delivery_fee_usd: num(f.get('frais_livraison_usd')) ?? 0,
    delivery_fee_per_km_usd: num(f.get('frais_par_km_usd')) ?? 0,
    min_order_usd: num(f.get('commande_min_usd')) ?? 0,
    avg_prep_minutes: num(f.get('temps_preparation_min')) ?? 30,
    delivery_zone: zone.length ? zone : null,
    address_verified: ['oui', 'on', 'true', '1'].includes(String(f.get('adresse_verifiee') ?? '').toLowerCase()),
    is_open: f.get('ouvert') !== null ? f.get('ouvert') === 'on' : true,
  };
}

export async function saveStore(formData: FormData) {
  const sb = await supabaseServer();
  const id = txt(formData.get('id'));
  const s = storeFromForm(formData);
  if (!s.name) redirect(`/admin/magasins${id ? '/' + id : ''}?err=Nom obligatoire`);
  // Une adresse ne peut être déclarée vérifiée que si elle est complète (commune + GPS).
  if (s.address_verified && (!s.commune || s.latitude == null || s.longitude == null)) s.address_verified = false;
  const res = id ? await sb.from('stores').update(s).eq('id', id).select('id').single() : await sb.from('stores').insert(s).select('id').single();
  if (res.error) redirect(`/admin/magasins${id ? '/' + id : ''}?err=${encodeURIComponent(res.error.message)}`);
  await sb.from('store_addresses').insert({
    store_id: res.data.id,
    full_text: [s.avenue, s.street_number, s.quartier, s.commune, s.city, s.province].filter(Boolean).join(', '),
    latitude: s.latitude, longitude: s.longitude, verified: s.address_verified,
    source: id ? 'correction admin' : 'saisie admin',
  });
  revalidatePath('/admin/magasins');
  redirect(`/admin/magasins/${res.data.id}?ok=Magasin enregistré`);
}

export async function setStoreActive(formData: FormData) {
  const sb = await supabaseServer();
  const id = String(formData.get('id'));
  await sb.from('stores').update({ is_active: formData.get('active') === '1' }).eq('id', id);
  revalidatePath('/admin/magasins');
  redirect(`/admin/magasins/${id}`);
}

/** Import CSV (séparateur virgule ou point-virgule, première ligne = en-têtes du modèle). */
export async function importStores(formData: FormData) {
  const file = formData.get('fichier');
  if (!(file instanceof File) || file.size === 0) redirect('/admin/magasins?err=Fichier manquant');
  const text = (await file.text()).replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (rows.length < 2) redirect('/admin/magasins?err=Fichier vide');
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const sb = await supabaseServer();
  let ok = 0;
  const errors: string[] = [];
  for (const [i, r] of rows.slice(1).entries()) {
    if (r.every((c) => !c.trim())) continue;
    const fd = new FormData();
    headers.forEach((h, j) => fd.set(h, r[j] ?? ''));
    const s = storeFromForm(fd);
    if (!s.name) { errors.push(`ligne ${i + 2} : nom manquant`); continue; }
    if (s.address_verified && (!s.commune || s.latitude == null || s.longitude == null)) s.address_verified = false;
    const res = s.code
      ? await sb.from('stores').upsert(s, { onConflict: 'code' }).select('id').single()
      : await sb.from('stores').insert(s).select('id').single();
    if (res.error) errors.push(`ligne ${i + 2} : ${res.error.message}`);
    else {
      ok++;
      await sb.from('store_addresses').insert({ store_id: res.data.id, latitude: s.latitude, longitude: s.longitude, verified: s.address_verified, source: 'import CSV',
        full_text: [s.avenue, s.street_number, s.quartier, s.commune, s.city].filter(Boolean).join(', ') });
    }
  }
  revalidatePath('/admin/magasins');
  const msg = `${ok} magasin(s) importé(s)` + (errors.length ? ` — erreurs : ${errors.slice(0, 5).join(' ; ')}` : '');
  redirect(`/admin/magasins?${errors.length ? 'err' : 'ok'}=${encodeURIComponent(msg)}`);
}

function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function addManager(formData: FormData) {
  const sb = await supabaseServer();
  const storeId = String(formData.get('store_id'));
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const title = String(formData.get('title') ?? 'directeur');
  // Vérifié côté serveur : mission « supermarchés » dans la région du magasin, rôle compatible.
  const { error } = await sb.rpc('staff_add_store_manager', { p_store_id: storeId, p_email: email, p_title: title });
  const messages: Record<string, string> = {
    USER_NOT_FOUND: "Aucun compte avec cet e-mail : la personne doit d'abord créer son compte dans l'application.",
    ROLE_CONFLICT: 'Ce compte a déjà un autre rôle (livreur, agent ou administrateur).',
    FORBIDDEN: 'Ce magasin est hors de votre zone.',
  };
  if (error) redirect(`/admin/magasins/${storeId}?err=${encodeURIComponent(messages[error.message] ?? error.message)}`);
  revalidatePath(`/admin/magasins/${storeId}`);
  redirect(`/admin/magasins/${storeId}?ok=Gestionnaire ajouté`);
}

export async function removeManager(formData: FormData) {
  const sb = await supabaseServer();
  const storeId = String(formData.get('store_id'));
  await sb.from('store_managers').delete().eq('store_id', storeId).eq('user_id', String(formData.get('user_id')));
  revalidatePath(`/admin/magasins/${storeId}`);
  redirect(`/admin/magasins/${storeId}?ok=Gestionnaire retiré`);
}
