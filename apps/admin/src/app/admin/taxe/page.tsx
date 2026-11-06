import type { CSSProperties } from 'react';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { requireSuper } from '@/lib/auth';
import { usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

// Taxe sur les achats (TVA) : taux et activation, réglés par l'administrateur général.
// Elle s'ajoute à chaque commande, sur les produits après réductions (pas sur les frais de livraison).

const kpi = (c: string) => ({ '--kpi': c }) as CSSProperties;
type Tax = { enabled: boolean; rate: number; label: string };

async function saveTax(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const rate = Number(String(f.get('rate') ?? '').replace(',', '.'));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) redirect('/admin/taxe?err=' + encodeURIComponent('Taux invalide : entre 0 et 100 %.'));
  const value: Tax = { enabled: f.get('enabled') === 'on', rate: Math.round(rate * 100) / 100, label: 'TVA' };
  const { error } = await sb.from('app_settings').upsert({ key: 'tax', value, updated_at: new Date().toISOString() });
  revalidatePath('/admin/taxe');
  redirect('/admin/taxe?' + (error
    ? 'err=' + encodeURIComponent(error.message)
    : 'ok=' + encodeURIComponent(value.enabled ? `TVA de ${String(value.rate).replace('.', ',')} % appliquée aux nouvelles commandes.` : 'Taxe désactivée pour les nouvelles commandes.')));
}

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireSuper();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: row }, { data: summary }] = await Promise.all([
    sb.from('app_settings').select('value').eq('key', 'tax').maybeSingle(),
    sb.rpc('tax_summary'),
  ]);
  const tax: Tax = { enabled: false, rate: 16, label: 'TVA', ...((row?.value as Partial<Tax>) ?? {}) };
  const s = (summary ?? {}) as { month_tax_usd?: number; month_orders?: number; total_tax_usd?: number; total_orders?: number };
  const rate = Number(tax.rate);
  const rateFr = String(rate).replace('.', ',');
  // Exemple : panier de 50 $, livraison 3 $.
  const exTax = Math.round(50 * rate) / 100;

  return (
    <>
      <h1>Taxe sur les achats (TVA)</h1>
      <p className="page-sub">
        La taxe s’ajoute à chaque commande, sur le prix des produits après les réductions (coupon, points de fidélité),
        sans les frais de livraison. Elle apparaît dans le panier, au paiement et sur le détail de chaque commande.
        Une commande déjà passée garde le taux du jour de l’achat.
      </p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card kpi" style={kpi(tax.enabled ? 'var(--green)' : 'var(--muted)')}>
          <div className="l">Taxe actuelle</div>
          <div className="v">{tax.enabled ? `${rateFr} %` : 'Désactivée'}</div>
          <div className="s">{tax.enabled ? 'Appliquée à chaque nouvelle commande' : 'Aucune taxe sur les nouvelles commandes'}</div>
        </div>
        <div className="card kpi" style={kpi('var(--accent)')}>
          <div className="l">TVA collectée ce mois-ci</div>
          <div className="v">{usd(s.month_tax_usd ?? 0)}</div>
          <div className="s">{s.month_orders ?? 0} commande(s) payée(s)</div>
        </div>
        <div className="card kpi" style={kpi('var(--amber)')}>
          <div className="l">TVA collectée au total</div>
          <div className="v">{usd(s.total_tax_usd ?? 0)}</div>
          <div className="s">{s.total_orders ?? 0} commande(s) payée(s)</div>
        </div>
      </div>

      <form action={saveTax} className="card stack" style={{ maxWidth: 560 }}>
        <div className="card-title"><span>Réglage</span></div>
        <label className="check"><input type="checkbox" name="enabled" defaultChecked={tax.enabled} /> Appliquer la taxe sur les achats</label>
        <label>Taux (%)
          <input name="rate" inputMode="decimal" defaultValue={rateFr} required style={{ maxWidth: 160 }} />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Exemple avec le taux actuel : produits 50,00 $ + livraison 3,00 $ → TVA {tax.enabled ? usd(exTax) : usd(0)} → total{' '}
          {usd(53 + (tax.enabled ? exTax : 0))}.
        </p>
        <div className="row"><button type="submit">Enregistrer</button></div>
      </form>
    </>
  );
}
