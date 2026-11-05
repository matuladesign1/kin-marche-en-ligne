import { revalidatePath } from 'next/cache';
import { requireSuper } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

async function saveRate(formData: FormData) {
  'use server';
  const currency = String(formData.get('currency'));
  const rate = Number(String(formData.get('rate') ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!['CDF', 'EUR'].includes(currency) || !Number.isFinite(rate) || rate <= 0) redirect('/admin/taux?err=Taux invalide');
  const sb = await supabaseServer();
  const { error } = await sb.from('exchange_rates').upsert({ currency, rate_per_usd: rate });
  revalidatePath('/admin/taux');
  redirect(`/admin/taux?${error ? 'err=' + encodeURIComponent(error.message) : 'ok=Taux enregistré'}`);
}

export default async function Taux({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireSuper();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: rates }, { data: history }] = await Promise.all([
    sb.from('exchange_rates').select('*'),
    sb.from('exchange_rate_history').select('*').order('recorded_at', { ascending: false }).limit(30),
  ]);
  const get = (c: string) => rates?.find((r) => r.currency === c);
  return (
    <>
      <h1>Taux de change</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">Les prix sont stockés en USD. Une devise n&apos;est proposée aux clients que lorsque son taux est saisi ici. CDF = franc congolais (pas le franc CFA).</p>
      {(['CDF', 'EUR'] as const).map((c) => (
        <form key={c} action={saveRate} className="card row" style={{ marginBottom: 12 }}>
          <input type="hidden" name="currency" value={c} />
          <label>1 USD = … {c}<input name="rate" defaultValue={get(c)?.rate_per_usd ?? ''} required inputMode="decimal" /></label>
          <span className="muted">{get(c) ? `Mis à jour le ${dateTime(get(c)!.updated_at)}` : 'Pas encore défini'}</span>
          <button type="submit">Enregistrer</button>
        </form>
      ))}
      <h2>Historique</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Devise</th><th>Taux (pour 1 USD)</th></tr></thead>
          <tbody>{(history ?? []).map((h) => <tr key={h.id}><td>{dateTime(h.recorded_at)}</td><td>{h.currency}</td><td>{h.rate_per_usd}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
