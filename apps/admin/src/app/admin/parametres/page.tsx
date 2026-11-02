import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { supabaseServer } from '@/lib/supabase-server';

const HEX = /^#[0-9A-Fa-f]{6}$/;

async function saveBranding(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { data: cur } = await sb.from('app_settings').select('value').eq('key', 'branding').single();
  const value = { ...(cur?.value ?? {}) } as Record<string, any>;
  const colors = { ...(value.colors ?? {}) };
  for (const k of ['primary', 'primary_dark', 'accent', 'accent_2']) {
    const v = String(formData.get(k) ?? '');
    if (HEX.test(v)) colors[k] = v.toUpperCase();
  }
  value.colors = colors;

  for (const [field, key] of [['logo_wide', 'logo_wide_url'], ['app_icon', 'app_icon_url']] as const) {
    const file = formData.get(field);
    if (file instanceof File && file.size > 0) {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) redirect('/admin/parametres?err=Format d’image non accepté');
      const path = `${field}-${Date.now()}.${file.name.split('.').pop()}`;
      const up = await sb.storage.from('branding').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) redirect(`/admin/parametres?err=${encodeURIComponent(up.error.message)}`);
      value[key] = sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
    }
  }
  if (formData.get('reset_logo') === 'on') { value.logo_wide_url = null; value.app_icon_url = null; }

  const { error } = await sb.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', 'branding');
  revalidatePath('/admin/parametres');
  redirect(`/admin/parametres?${error ? 'err=' + encodeURIComponent(error.message) : 'ok=Identité visuelle mise à jour'}`);
}

export default async function Parametres({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data } = await sb.from('app_settings').select('value').eq('key', 'branding').single();
  const b = (data?.value ?? {}) as Record<string, any>;
  const c = b.colors ?? {};
  return (
    <>
      <h1>Logo et couleurs</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">Les changements s&apos;appliquent à l&apos;application sans mise à jour du code. Le logo fourni n&apos;est pas retouché : il est affiché tel quel.</p>
      <form action={saveBranding} className="stack card">
        <div className="cols">
          <label>Logo horizontal (thème)<input type="file" name="logo_wide" accept="image/*" /></label>
          <label>Logo carré (icône)<input type="file" name="app_icon" accept="image/*" /></label>
        </div>
        {b.logo_wide_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logo_wide_url} alt="Logo actuel" style={{ maxWidth: 300 }} />
        ) : <span className="muted">Logo par défaut intégré à l&apos;application.</span>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="reset_logo" /> Revenir au logo par défaut</label>
        <div className="cols">
          {[['primary', 'Rouge principal'], ['primary_dark', 'Rouge foncé'], ['accent', 'Bleu'], ['accent_2', 'Bleu-vert']].map(([k, l]) => (
            <label key={k}>{l}<input type="color" name={k} defaultValue={c[k] ?? '#DE3530'} /></label>
          ))}
        </div>
        <div><button type="submit">Enregistrer</button></div>
      </form>
    </>
  );
}
