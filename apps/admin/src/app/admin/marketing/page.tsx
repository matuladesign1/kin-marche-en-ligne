import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { MediaUpload } from '@/components/MediaUpload';
import { Flash } from '@/components/Shell';
import { inScope, requirePermission } from '@/lib/auth';
import { dateTime, usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const back = (q: string) => redirect(`/admin/marketing?${q}`);
const BRANDING = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/`;
/** N'accepte que des fichiers envoyés dans le dossier public « branding » du projet. */
const brandingUrl = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s.startsWith(BRANDING) ? s : null;
};
const ERR: Record<string, string> = { 'new row violates row-level security policy': 'Action hors de votre zone ou non autorisée.' };
const msg = (m: string) => encodeURIComponent(Object.entries(ERR).find(([k]) => m.includes(k))?.[1] ?? m);

async function addCoupon(f: FormData) {
  'use server';
  await requirePermission('marketing');
  const sb = await supabaseServer();
  const value = Number(String(f.get('value')).replace(',', '.'));
  const { error } = await sb.from('coupons').insert({
    code: String(f.get('code')).trim().toUpperCase(), description: String(f.get('description') ?? '') || null,
    discount_type: String(f.get('type')), discount_value: value,
    min_order_usd: Number(f.get('min') || 0), max_discount_usd: f.get('max') ? Number(f.get('max')) : null,
    store_id: String(f.get('store_id') ?? '') || null,
    starts_at: String(f.get('starts') ?? '') || null, ends_at: String(f.get('ends') ?? '') || null,
    usage_limit: f.get('limit') ? Number(f.get('limit')) : null, per_user_limit: Number(f.get('per_user') || 1),
    is_public: f.get('public') === 'on',
  });
  revalidatePath('/admin/marketing');
  back(error ? 'err=' + msg(error.message) : 'ok=Coupon créé');
}

async function toggle(f: FormData) {
  'use server';
  await requirePermission('marketing');
  const sb = await supabaseServer();
  const table = String(f.get('table'));
  if (!['coupons', 'banners', 'partners'].includes(table)) back('err=Table inconnue');
  const { error } = await sb.from(table).update({ is_active: f.get('active') === '1' }).eq('id', String(f.get('id')));
  revalidatePath('/admin/marketing');
  back(error ? 'err=' + msg(error.message) : 'ok=Mis à jour');
}

async function addBanner(f: FormData) {
  'use server';
  await requirePermission('marketing');
  const sb = await supabaseServer();
  const media = f.get('media_type') === 'video' ? 'video' : 'image';
  const image = brandingUrl(f.get('image_url'));
  const video = media === 'video' ? brandingUrl(f.get('video_url')) : null;
  if (!image) back('err=' + encodeURIComponent(media === 'video' ? 'Image d’aperçu obligatoire (affichée pendant le chargement de la vidéo).' : 'Image obligatoire.'));
  if (media === 'video' && !video) back('err=' + encodeURIComponent('Vidéo obligatoire pour une bannière vidéo.'));
  const { error } = await sb.from('banners').insert({
    title: String(f.get('title') ?? '').trim() || null, image_url: image, media_type: media, video_url: video,
    link_type: String(f.get('link_type') ?? '') || null, link_value: String(f.get('link_value') ?? '').trim() || null,
    store_id: String(f.get('store_id') ?? '') || null, sort_order: Number(f.get('sort') || 0),
    starts_at: String(f.get('starts') ?? '') || null, ends_at: String(f.get('ends') ?? '') || null,
  });
  revalidatePath('/admin/marketing');
  back(error ? 'err=' + msg(error.message) : 'ok=Bannière publiée');
}

async function addPartner(f: FormData) {
  'use server';
  await requirePermission('marketing');
  const sb = await supabaseServer();
  const { error } = await sb.from('partners').insert({
    name: String(f.get('name')).trim(), logo_url: brandingUrl(f.get('logo_url')),
    website: String(f.get('website') ?? '').trim() || null, sort_order: Number(f.get('sort') || 0),
  });
  revalidatePath('/admin/marketing');
  back(error ? 'err=' + msg(error.message) : 'ok=Partenaire ajouté');
}

function Toggle({ table, id, active }: { table: string; id: string; active: boolean }) {
  return (
    <form action={toggle}>
      <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={active ? '0' : '1'} />
      <button className="secondary">{active ? 'Désactiver' : 'Activer'}</button>
    </form>
  );
}

const LINKS: Record<string, string> = { product: 'Produit', category: 'Catégorie', promotion: 'Promotion', url: 'Site web' };

export default async function Marketing({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requirePermission('marketing');
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: coupons }, { data: banners }, { data: partners }, { data: storeRows }] = await Promise.all([
    sb.from('coupons').select('*').order('created_at', { ascending: false }),
    sb.from('banners').select('*').order('sort_order'),
    sb.from('partners').select('*').order('sort_order').order('name'),
    sb.from('stores').select('id, name, province, city, commune').order('name'),
  ]);
  const stores = (storeRows ?? []).filter((s) => inScope(user, 'marketing', s));
  const national = user.isSuper || user.scopes.some((s) => s.permission === 'marketing' && !s.province && !s.city && !s.commune);
  const storeName = (id: string | null) => (id ? (storeRows ?? []).find((s) => s.id === id)?.name ?? 'Magasin' : 'Toute l’application');
  const period = (b: { starts_at: string | null; ends_at: string | null }) =>
    b.starts_at || b.ends_at ? `${b.starts_at ? `du ${dateTime(b.starts_at)}` : ''}${b.ends_at ? ` jusqu’au ${dateTime(b.ends_at)}` : ''}` : 'Permanente';

  const storeSelect = (
    <label>Portée
      <select name="store_id" defaultValue={national ? '' : stores[0]?.id}>
        {national ? <option value="">Toute l’application</option> : null}
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <h1>Coupons, bannières et partenaires</h1>
      <p className="page-sub">Bannières photo ou vidéo de l’accueil (défilement automatique dans l’application), coupons de réduction et logos des partenaires.</p>
      <Flash ok={sp.ok} err={sp.err} />

      <h2>Bannières de l’accueil</h2>
      <div className="banner-grid">
        {(banners ?? []).map((b) => (
          <div key={b.id} className="card banner-card">
            <div className="banner-media">
              {b.media_type === 'video' && b.video_url ? (
                <video src={b.video_url} poster={b.image_url} muted loop playsInline controls preload="none" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.image_url} alt={b.title ?? 'Bannière'} />
              )}
              <span className="banner-kind">{b.media_type === 'video' ? 'Vidéo' : 'Photo'}</span>
            </div>
            <div className="banner-meta">
              <b>{b.title || 'Sans titre'}</b>
              {b.is_active ? <span className="badge ok">active</span> : <span className="badge">inactive</span>}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Ordre {b.sort_order} · {storeName(b.store_id)} · {period(b)}
              {b.link_type ? ` · lien : ${LINKS[b.link_type] ?? b.link_type}` : ''}
            </div>
            <Toggle table="banners" id={b.id} active={b.is_active} />
          </div>
        ))}
        {!banners?.length ? <p className="muted">Aucune bannière pour le moment.</p> : null}
      </div>
      <form action={addBanner} className="card stack" style={{ marginTop: 14 }}>
        <div className="card-title"><span>Nouvelle bannière</span></div>
        <div className="notice" style={{ margin: 0 }}>
          Format conseillé : <b>1200 × 600 px (rapport 2:1)</b> — toutes les bannières s’affichent à la même taille.
          Vidéo : MP4 (H.264), 15 secondes maximum, 50 Mo maximum, lue sans le son ; ajoutez une image d’aperçu au même format.
        </div>
        <div className="cols">
          <label>Type de bannière
            <select name="media_type" defaultValue="image">
              <option value="image">Photo</option>
              <option value="video">Vidéo (avec image d’aperçu)</option>
            </select>
          </label>
          <MediaUpload name="image_url" label="Image ou image d’aperçu *" accept="image/jpeg,image/png,image/webp" prefix="banner" maxMb={8} kind="image" hint="JPG, PNG ou WebP · 8 Mo max." />
          <MediaUpload name="video_url" label="Vidéo (si type Vidéo)" accept="video/mp4,video/webm,video/quicktime" prefix="banner" maxMb={50} kind="video" hint="MP4, WebM ou MOV · 50 Mo max." />
          <label>Titre (affiché sur la bannière)<input name="title" maxLength={80} /></label>
          {storeSelect}
          <label>Lien au toucher
            <select name="link_type" defaultValue="">
              <option value="">Aucun</option>
              {Object.entries(LINKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Valeur du lien (identifiant ou adresse https)<input name="link_value" /></label>
          <label>Ordre d’affichage<input name="sort" defaultValue={0} inputMode="numeric" /></label>
          <label>Début<input type="datetime-local" name="starts" /></label>
          <label>Fin<input type="datetime-local" name="ends" /></label>
        </div>
        <div><button type="submit">Publier la bannière</button></div>
      </form>

      <h2 style={{ marginTop: 28 }}>Coupons</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Réduction</th><th>Conditions</th><th>Utilisations</th><th>Validité</th><th></th></tr></thead>
          <tbody>
            {(coupons ?? []).map((c) => (
              <tr key={c.id}>
                <td><b>{c.code}</b> {c.is_public ? <span className="badge ok">public</span> : <span className="badge">privé</span>}</td>
                <td>{c.discount_type === 'percent' ? `${c.discount_value} %` : usd(c.discount_value)}</td>
                <td>min. {usd(c.min_order_usd)}{c.max_discount_usd ? ` · max ${usd(c.max_discount_usd)}` : ''} · {storeName(c.store_id)}</td>
                <td>{c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ''} · {c.per_user_limit}/client</td>
                <td>{c.ends_at ? `jusqu’au ${dateTime(c.ends_at)}` : 'sans fin'}</td>
                <td><Toggle table="coupons" id={c.id} active={c.is_active} /></td>
              </tr>
            ))}
            {!coupons?.length ? <tr><td colSpan={6} className="muted">Aucun coupon.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <form action={addCoupon} className="card stack" style={{ marginTop: 12 }}>
        <div className="card-title"><span>Nouveau coupon</span></div>
        <div className="cols">
          <label>Code *<input name="code" required /></label>
          <label>Type<select name="type"><option value="percent">Pourcentage</option><option value="fixed">Montant fixe (USD)</option></select></label>
          <label>Valeur *<input name="value" required inputMode="decimal" /></label>
          <label>Commande minimum (USD)<input name="min" inputMode="decimal" /></label>
          <label>Réduction maximum (USD)<input name="max" inputMode="decimal" /></label>
          {storeSelect}
          <label>Début<input type="datetime-local" name="starts" /></label>
          <label>Fin<input type="datetime-local" name="ends" /></label>
          <label>Utilisations max (total)<input name="limit" inputMode="numeric" /></label>
          <label>Par client<input name="per_user" defaultValue={1} inputMode="numeric" /></label>
          <label>Description<input name="description" /></label>
        </div>
        <label className="check"><input type="checkbox" name="public" /> Visible dans l’application (page Coupons)</label>
        <div><button type="submit">Créer le coupon</button></div>
      </form>

      <h2 style={{ marginTop: 28 }}>Partenaires <span className="muted">({partners?.length ?? 0})</span></h2>
      <p className="page-sub">Les logos s’affichent en bas de l’onglet Compte de l’application, tous à la même taille. Logo carré ou horizontal sur fond transparent (PNG ou SVG).</p>
      {national ? (
        <>
          <div className="partner-grid">
            {(partners ?? []).map((p) => (
              <div key={p.id} className={`partner-tile${p.is_active ? '' : ' off'}`}>
                <div className="logo">
                  {p.logo_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.logo_url} alt={p.name} />
                    : <span>{p.name.slice(0, 2).toUpperCase()}</span>}
                </div>
                <div className="name" title={p.name}>{p.name}</div>
                <Toggle table="partners" id={p.id} active={p.is_active} />
              </div>
            ))}
          </div>
          <form action={addPartner} className="card stack" style={{ marginTop: 12 }}>
            <div className="card-title"><span>Nouveau partenaire</span></div>
            <div className="cols">
              <label>Nom *<input name="name" required /></label>
              <MediaUpload name="logo_url" label="Logo" accept="image/png,image/svg+xml,image/webp,image/jpeg" prefix="partner" maxMb={4} kind="image" hint="PNG ou SVG transparent · 4 Mo max." />
              <label>Site web<input name="website" type="url" placeholder="https://" /></label>
              <label>Ordre d’affichage<input name="sort" defaultValue={0} inputMode="numeric" /></label>
            </div>
            <div><button type="submit">Ajouter le partenaire</button></div>
          </form>
        </>
      ) : (
        <p className="muted">Les partenaires sont gérés au niveau national (Direction ou agent marketing sans limite de région).</p>
      )}
    </>
  );
}
