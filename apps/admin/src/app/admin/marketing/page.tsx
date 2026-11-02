import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { dateTime, usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const back = (q: string) => redirect(`/admin/marketing?${q}`);

async function upload(file: FormDataEntryValue | null, prefix: string) {
  if (!(file instanceof File) || file.size === 0) return null;
  const sb = await supabaseServer();
  const path = `${prefix}-${Date.now()}.${file.name.split('.').pop() ?? 'jpg'}`;
  const up = await sb.storage.from('branding').upload(path, file, { contentType: file.type });
  if (up.error) throw up.error;
  return sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
}

async function addCoupon(f: FormData) {
  'use server';
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
  back(error ? 'err=' + encodeURIComponent(error.message) : 'ok=Coupon créé');
}

async function toggle(f: FormData) {
  'use server';
  const sb = await supabaseServer();
  const table = String(f.get('table'));
  if (!['coupons', 'banners', 'partners'].includes(table)) back('err=Table inconnue');
  await sb.from(table).update({ is_active: f.get('active') === '1' }).eq('id', String(f.get('id')));
  revalidatePath('/admin/marketing');
  back('ok=Mis à jour');
}

async function addBanner(f: FormData) {
  'use server';
  const sb = await supabaseServer();
  let url: string | null = null;
  try { url = await upload(f.get('image'), 'banner'); } catch (e) { back('err=' + encodeURIComponent((e as Error).message)); }
  if (!url) back('err=Image obligatoire');
  const { error } = await sb.from('banners').insert({
    title: String(f.get('title') ?? '') || null, image_url: url, link_type: String(f.get('link_type') ?? '') || null,
    link_value: String(f.get('link_value') ?? '') || null, sort_order: Number(f.get('sort') || 0),
    starts_at: String(f.get('starts') ?? '') || null, ends_at: String(f.get('ends') ?? '') || null,
  });
  revalidatePath('/admin/marketing');
  back(error ? 'err=' + encodeURIComponent(error.message) : 'ok=Bannière publiée');
}

async function addPartner(f: FormData) {
  'use server';
  const sb = await supabaseServer();
  let logo: string | null = null;
  try { logo = await upload(f.get('logo'), 'partner'); } catch (e) { back('err=' + encodeURIComponent((e as Error).message)); }
  const { error } = await sb.from('partners').insert({ name: String(f.get('name')).trim(), logo_url: logo, website: String(f.get('website') ?? '') || null });
  revalidatePath('/admin/marketing');
  back(error ? 'err=' + encodeURIComponent(error.message) : 'ok=Partenaire ajouté');
}

function Toggle({ table, id, active }: { table: string; id: string; active: boolean }) {
  return (
    <form action={toggle}>
      <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={active ? '0' : '1'} />
      <button className="secondary">{active ? 'Désactiver' : 'Activer'}</button>
    </form>
  );
}

export default async function Marketing({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: coupons }, { data: banners }, { data: partners }, { data: stores }] = await Promise.all([
    sb.from('coupons').select('*').order('created_at', { ascending: false }),
    sb.from('banners').select('*').order('sort_order'),
    sb.from('partners').select('*').order('sort_order'),
    sb.from('stores').select('id, name').order('name'),
  ]);
  return (
    <>
      <h1>Coupons, bannières et partenaires</h1>
      <Flash ok={sp.ok} err={sp.err} />

      <h2>Coupons</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Réduction</th><th>Conditions</th><th>Utilisations</th><th>Validité</th><th></th></tr></thead>
          <tbody>
            {(coupons ?? []).map((c) => (
              <tr key={c.id}>
                <td><b>{c.code}</b> {c.is_public ? <span className="badge ok">public</span> : <span className="badge">privé</span>}</td>
                <td>{c.discount_type === 'percent' ? `${c.discount_value} %` : usd(c.discount_value)}</td>
                <td>min. {usd(c.min_order_usd)}{c.max_discount_usd ? ` · max ${usd(c.max_discount_usd)}` : ''}{c.store_id ? ` · ${stores?.find((s) => s.id === c.store_id)?.name}` : ''}</td>
                <td>{c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ''} · {c.per_user_limit}/client</td>
                <td>{c.ends_at ? `jusqu'au ${dateTime(c.ends_at)}` : 'sans fin'}</td>
                <td><Toggle table="coupons" id={c.id} active={c.is_active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={addCoupon} className="card stack" style={{ marginTop: 12 }}>
        <div className="cols">
          <label>Code *<input name="code" required /></label>
          <label>Type<select name="type"><option value="percent">Pourcentage</option><option value="fixed">Montant fixe (USD)</option></select></label>
          <label>Valeur *<input name="value" required inputMode="decimal" /></label>
          <label>Commande minimum (USD)<input name="min" inputMode="decimal" /></label>
          <label>Réduction maximum (USD)<input name="max" inputMode="decimal" /></label>
          <label>Magasin<select name="store_id"><option value="">Tous</option>{(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Début<input type="datetime-local" name="starts" /></label>
          <label>Fin<input type="datetime-local" name="ends" /></label>
          <label>Utilisations max (total)<input name="limit" inputMode="numeric" /></label>
          <label>Par client<input name="per_user" defaultValue={1} inputMode="numeric" /></label>
          <label>Description<input name="description" /></label>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="public" /> Visible dans l&apos;application (page Coupons)</label>
        <div><button type="submit">Créer le coupon</button></div>
      </form>

      <h2>Bannières de l&apos;accueil</h2>
      <div className="row">
        {(banners ?? []).map((b) => (
          <div key={b.id} className="card" style={{ width: 260 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.image_url} alt="" style={{ width: '100%', borderRadius: 8 }} />
            <div>{b.title} {b.is_active ? <span className="badge ok">active</span> : <span className="badge">inactive</span>}</div>
            <Toggle table="banners" id={b.id} active={b.is_active} />
          </div>
        ))}
      </div>
      <form action={addBanner} className="card stack" style={{ marginTop: 12 }}>
        <div className="cols">
          <label>Image * (format paysage)<input type="file" name="image" accept="image/*" required /></label>
          <label>Titre<input name="title" /></label>
          <label>Lien vers<select name="link_type"><option value="">Aucun</option><option value="product">Produit</option><option value="category">Catégorie</option><option value="url">Site web</option></select></label>
          <label>Valeur du lien (identifiant ou URL)<input name="link_value" /></label>
          <label>Ordre<input name="sort" defaultValue={0} inputMode="numeric" /></label>
          <label>Début<input type="datetime-local" name="starts" /></label>
          <label>Fin<input type="datetime-local" name="ends" /></label>
        </div>
        <div><button type="submit">Publier la bannière</button></div>
      </form>

      <h2>Partenaires</h2>
      <div className="row">
        {(partners ?? []).map((p) => (
          <div key={p.id} className="card" style={{ width: 200 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.logo_url ? <img src={p.logo_url} alt="" style={{ width: '100%', height: 60, objectFit: 'contain' }} /> : null}
            <div>{p.name}</div>
            <Toggle table="partners" id={p.id} active={p.is_active} />
          </div>
        ))}
      </div>
      <form action={addPartner} className="card row" style={{ marginTop: 12 }}>
        <label>Nom *<input name="name" required /></label>
        <label>Logo<input type="file" name="logo" accept="image/*" /></label>
        <label>Site web<input name="website" type="url" /></label>
        <button type="submit">Ajouter</button>
      </form>
    </>
  );
}
