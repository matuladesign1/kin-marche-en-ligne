import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { dateTime, usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const TYPES: Record<string, string> = {
  sale: 'Ventes confirmées', refund: 'Remboursements', commission: 'Commissions plateforme',
  driver_payout_due: 'Dû aux livreurs', store_payout: 'Versé aux magasins', driver_payout: 'Versé aux livreurs',
  expense: 'Dépenses', budget: 'Budgets attribués',
};

function period(sp: { from?: string; to?: string }) {
  const to = sp.to || new Date().toISOString().slice(0, 10);
  const from = sp.from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  return { from, to, fromTs: `${from}T00:00:00+01:00`, toTs: `${to}T23:59:59+01:00` };
}

async function createBudget(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const from = String(formData.get('from')), to = String(formData.get('to'));
  const total = Number(String(formData.get('total') ?? '').replace(',', '.'));
  if (!from || !to || !Number.isFinite(total) || total <= 0) redirect('/admin/finances?err=Période et montant obligatoires');
  const { data: u } = await sb.auth.getUser();
  const { data: ledger } = await sb.from('financial_ledger').select('entry_type, store_id, amount_usd')
    .in('entry_type', ['sale', 'refund']).gte('created_at', `${from}T00:00:00+01:00`).lte('created_at', `${to}T23:59:59+01:00`);
  // Ventes nettes = ventes confirmées − remboursements, par magasin.
  const net: Record<string, number> = {};
  for (const r of ledger ?? []) {
    if (!r.store_id) continue;
    net[r.store_id] = (net[r.store_id] ?? 0) + (r.entry_type === 'sale' ? 1 : -1) * Number(r.amount_usd);
  }
  const sum = Object.values(net).reduce((s, v) => s + Math.max(v, 0), 0);
  if (sum <= 0) redirect('/admin/finances?err=Aucune vente nette sur cette période : répartition impossible');
  const b = await sb.from('budgets').insert({ period_start: from, period_end: to, total_usd: total, created_by: u.user!.id }).select('id').single();
  if (b.error) redirect(`/admin/finances?err=${encodeURIComponent(b.error.message)}`);
  const rows = Object.entries(net).filter(([, v]) => v > 0).map(([store_id, v]) => ({
    budget_id: b.data.id, store_id, net_sales_usd: Math.round(v * 100) / 100,
    share: Math.round((v / sum) * 1e6) / 1e6, allocated_usd: Math.round(total * (v / sum) * 100) / 100,
  }));
  const a = await sb.from('budget_allocations').insert(rows);
  if (a.error) redirect(`/admin/finances?err=${encodeURIComponent(a.error.message)}`);
  revalidatePath('/admin/finances');
  redirect(`/admin/finances?ok=Budget réparti entre ${rows.length} magasin(s)`);
}

export default async function Finances({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; ok?: string; err?: string }> }) {
  await requirePermission('finance');
  const sp = await searchParams;
  const p = period(sp);
  const sb = await supabaseServer();
  const [{ data: ledger }, { data: stores }, { data: pending }, { data: refunds }, { data: budgets }] = await Promise.all([
    sb.from('financial_ledger').select('entry_type, store_id, amount_usd').gte('created_at', p.fromTs).lte('created_at', p.toTs),
    sb.from('stores').select('id, name'),
    sb.from('orders').select('total_usd').in('payment_status', ['pending', 'processing']).gte('created_at', p.fromTs).lte('created_at', p.toTs),
    sb.from('refunds').select('id, amount_usd, reason, status, created_at, orders(order_number)').order('created_at', { ascending: false }).limit(20),
    sb.from('budgets').select('id, period_start, period_end, total_usd, created_at, budget_allocations(store_id, net_sales_usd, share, allocated_usd)').order('created_at', { ascending: false }).limit(10),
  ]);
  const totals: Record<string, number> = {};
  const byStore: Record<string, { sale: number; commission: number; refund: number }> = {};
  for (const r of ledger ?? []) {
    totals[r.entry_type] = (totals[r.entry_type] ?? 0) + Number(r.amount_usd);
    if (r.store_id) {
      byStore[r.store_id] ??= { sale: 0, commission: 0, refund: 0 };
      if (r.entry_type in byStore[r.store_id]) byStore[r.store_id][r.entry_type as 'sale'] += Number(r.amount_usd);
    }
  }
  const name = (id: string) => stores?.find((s) => s.id === id)?.name ?? id;
  const pendingTotal = (pending ?? []).reduce((s, o) => s + Number(o.total_usd), 0);
  const net = (totals.sale ?? 0) - (totals.refund ?? 0);

  return (
    <>
      <h1>Finances et budgets</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <form className="row" style={{ marginBottom: 12 }}>
        <label>Du<input type="date" name="from" defaultValue={p.from} /></label>
        <label>Au<input type="date" name="to" defaultValue={p.to} /></label>
        <button className="secondary">Afficher</button>
      </form>
      <div className="grid">
        <div className="card stat"><div className="v">{usd(totals.sale)}</div><div className="l">Paiements confirmés</div></div>
        <div className="card stat"><div className="v">{usd(pendingTotal)}</div><div className="l">En attente (non comptés)</div></div>
        <div className="card stat"><div className="v">{usd(totals.refund)}</div><div className="l">Remboursements</div></div>
        <div className="card stat"><div className="v">{usd(net)}</div><div className="l">Ventes nettes</div></div>
        <div className="card stat"><div className="v">{usd(totals.commission)}</div><div className="l">Commissions plateforme</div></div>
        <div className="card stat"><div className="v">{usd(totals.driver_payout_due)}</div><div className="l">Dû aux livreurs</div></div>
      </div>

      <h2>Par magasin</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Magasin</th><th>Ventes</th><th>Remboursements</th><th>Commission</th><th>Montant dû au magasin</th></tr></thead>
          <tbody>
            {Object.entries(byStore).map(([id, v]) => (
              <tr key={id}><td>{name(id)}</td><td>{usd(v.sale)}</td><td>{usd(v.refund)}</td><td>{usd(v.commission)}</td><td>{usd(v.sale - v.refund - v.commission)}</td></tr>
            ))}
            {!Object.keys(byStore).length ? <tr><td colSpan={5} className="muted">Aucun mouvement sur la période.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Répartir un budget selon les ventes réelles</h2>
      <form action={createBudget} className="card row">
        <label>Période du<input type="date" name="from" defaultValue={p.from} required /></label>
        <label>au<input type="date" name="to" defaultValue={p.to} required /></label>
        <label>Budget total (USD)<input name="total" inputMode="decimal" required /></label>
        <button type="submit">Calculer et enregistrer</button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Budget du magasin = budget total × (ventes nettes du magasin ÷ ventes nettes de tous les magasins). Seuls les paiements confirmés comptent.</p>
      {(budgets ?? []).map((b: any) => (
        <div key={b.id} className="card" style={{ marginBottom: 8 }}>
          <b>{usd(b.total_usd)}</b> — du {b.period_start} au {b.period_end} <span className="muted">({dateTime(b.created_at)})</span>
          {(b.budget_allocations ?? []).map((a: any) => (
            <div key={a.store_id}>{name(a.store_id)} : {usd(a.allocated_usd)} <span className="muted">({(Number(a.share) * 100).toFixed(1)} % · ventes nettes {usd(a.net_sales_usd)})</span></div>
          ))}
        </div>
      ))}

      <h2>Derniers remboursements</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Commande</th><th>Montant</th><th>Motif</th><th>Statut</th></tr></thead>
          <tbody>
            {(refunds ?? []).map((r: any) => <tr key={r.id}><td>{dateTime(r.created_at)}</td><td>{r.orders?.order_number}</td><td>{usd(r.amount_usd)}</td><td>{r.reason}</td><td>{r.status}</td></tr>)}
            {!refunds?.length ? <tr><td colSpan={5} className="muted">Aucun remboursement.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{Object.entries(TYPES).map(([k, l]) => `${l} : ${usd(totals[k])}`).join(' · ')}</p>
    </>
  );
}
