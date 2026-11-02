import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { supabaseServer } from '@/lib/supabase-server';

const LANGS = [['fr', 'Français'], ['en', 'English'], ['ln', 'Lingala'], ['sw', 'Kiswahili']] as const;

async function saveCategory(f: FormData) {
  'use server';
  const sb = await supabaseServer();
  const id = String(f.get('id') ?? '');
  const name = Object.fromEntries(LANGS.map(([k]) => [k, String(f.get(`name_${k}`) ?? '').trim()]).filter(([, v]) => v));
  if (!name.fr) redirect('/admin/categories?err=Nom français obligatoire');
  const row = {
    name, icon: String(f.get('icon') ?? '') || null, sort_order: Number(f.get('sort') || 0),
    parent_id: String(f.get('parent_id') ?? '') || null, is_active: f.get('active') === 'on',
  };
  const res = id
    ? await sb.from('product_categories').update(row).eq('id', id)
    : await sb.from('product_categories').insert({ ...row, slug: name.fr.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') });
  revalidatePath('/admin/categories');
  redirect(`/admin/categories?${res.error ? 'err=' + encodeURIComponent(res.error.message) : 'ok=Catégorie enregistrée'}`);
}

function CategoryForm({ c, parents }: { c?: any; parents: { id: string; name: { fr?: string } }[] }) {
  return (
    <form action={saveCategory} className="row card" style={{ marginBottom: 8 }}>
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      {LANGS.map(([k, l]) => <label key={k}>{l}<input name={`name_${k}`} defaultValue={c?.name?.[k] ?? ''} required={k === 'fr'} /></label>)}
      <label>Icône (Ionicons)<input name="icon" defaultValue={c?.icon ?? ''} style={{ width: 110 }} /></label>
      <label>Ordre<input name="sort" defaultValue={c?.sort_order ?? 0} style={{ width: 70 }} /></label>
      <label>Parent<select name="parent_id" defaultValue={c?.parent_id ?? ''}><option value="">—</option>{parents.filter((p) => p.id !== c?.id).map((p) => <option key={p.id} value={p.id}>{p.name.fr}</option>)}</select></label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="active" defaultChecked={c ? c.is_active : true} /> active</label>
      <button className="secondary">{c ? 'Enregistrer' : 'Ajouter'}</button>
    </form>
  );
}

export default async function Categories({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data } = await sb.from('product_categories').select('*').order('sort_order');
  const parents = (data ?? []).filter((c) => !c.parent_id);
  return (
    <>
      <h1>Catégories de produits</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">Les traductions lingala et swahili sont à faire valider par des locuteurs natifs.</p>
      {(data ?? []).map((c) => <CategoryForm key={c.id} c={c} parents={parents} />)}
      <h2>Nouvelle catégorie</h2>
      <CategoryForm parents={parents} />
    </>
  );
}
