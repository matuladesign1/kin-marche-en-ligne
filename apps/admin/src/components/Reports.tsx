import type { SupabaseClient } from '@supabase/supabase-js';
import { PAY_FR, STATUS_FR, usd } from '@/lib/format';
import { fetchOrders, filtersToQuery, type ReportFilters } from '@/lib/reports';

const EXPORTS_ADMIN: [string, string][] = [
  ['commandes', 'Commandes'], ['articles', 'Articles vendus'], ['paiements', 'Paiements'], ['journal', 'Journal financier'],
  ['stock', 'Produits et stock'], ['clients', 'Clients'], ['livreurs', 'Livreurs'], ['magasins', 'Magasins (format import)'],
];
const EXPORTS_STORE: [string, string][] = [
  ['commandes', 'Commandes'], ['articles', 'Articles vendus'], ['paiements', 'Paiements'], ['journal', 'Journal financier'], ['stock', 'Produits et stock'],
];

function group<T>(rows: T[], key: (r: T) => string, value: (r: T) => number) {
  const m = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const k = key(r) || '—';
    const cur = m.get(k) ?? { n: 0, sum: 0 };
    cur.n += 1; cur.sum += value(r);
    m.set(k, cur);
  }
  return [...m.entries()].sort((a, b) => b[1].sum - a[1].sum);
}

export async function Reports({ sb, filters, scope, basePath, stores }: {
  sb: SupabaseClient; filters: ReportFilters; scope: 'admin' | 'store'; basePath: string; stores: { id: string; name: string }[];
}) {
  const orders = await fetchOrders(sb, filters);
  const paid = orders.filter((o) => o.payment_status === 'succeeded');
  const revenue = paid.reduce((s, o) => s + Number(o.total_usd), 0);
  const cancelled = orders.filter((o) => o.status === 'cancelled').length;
  const completed = orders.filter((o) => o.status === 'completed').length;
  const customers = new Set(paid.map((o) => o.customer_id)).size;
  const byStore = group(paid, (o) => o.stores?.name, (o) => Number(o.total_usd));
  const byCommune = group(paid, (o) => o.delivery_address?.commune, (o) => Number(o.total_usd));
  const byDay = group(paid, (o) => new Date(o.paid_at ?? o.created_at).toLocaleDateString('fr-CA', { timeZone: 'Africa/Kinshasa' }), (o) => Number(o.total_usd))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const byStatus = group(orders, (o) => STATUS_FR[o.status], () => 1);
  const maxDay = Math.max(1, ...byDay.map(([, v]) => v.sum));
  const qs = filtersToQuery(filters);

  return (
    <>
      <form className="card stack" method="get">
        <div className="cols">
          <label>Du<input type="date" name="from" defaultValue={filters.from} /></label>
          <label>Au<input type="date" name="to" defaultValue={filters.to} /></label>
          <label>Magasin
            <select name="store" defaultValue={filters.store ?? ''}>
              {scope === 'admin' ? <option value="">Tous</option> : null}
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {scope === 'admin' ? <label>Province (magasin)<input name="province" defaultValue={filters.province ?? ''} /></label> : null}
          {scope === 'admin' ? <label>Ville (magasin)<input name="city" defaultValue={filters.city ?? ''} /></label> : null}
          <label>Commune (livraison)<input name="commune" defaultValue={filters.commune ?? ''} /></label>
          <label>Quartier (livraison)<input name="quartier" defaultValue={filters.quartier ?? ''} /></label>
          <label>Client (nom, e-mail, tél.)<input name="client" defaultValue={filters.client ?? ''} /></label>
          <label>Statut
            <select name="status" defaultValue={filters.status ?? ''}><option value="">Tous</option>{Object.entries(STATUS_FR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label>Paiement
            <select name="payment" defaultValue={filters.payment ?? ''}><option value="">Tous</option>{Object.entries(PAY_FR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        </div>
        <div><button type="submit">Appliquer les filtres</button></div>
      </form>

      <div className="grid" style={{ marginTop: 12 }}>
        <div className="card stat"><div className="v">{usd(revenue)}</div><div className="l">Chiffre d&apos;affaires payé</div></div>
        <div className="card stat"><div className="v">{orders.length}</div><div className="l">Commandes (tous statuts)</div></div>
        <div className="card stat"><div className="v">{paid.length}</div><div className="l">Commandes payées</div></div>
        <div className="card stat"><div className="v">{usd(paid.length ? revenue / paid.length : 0)}</div><div className="l">Panier moyen payé</div></div>
        <div className="card stat"><div className="v">{completed}</div><div className="l">Livrées et terminées</div></div>
        <div className="card stat"><div className="v">{orders.length ? Math.round((cancelled / orders.length) * 100) : 0} %</div><div className="l">Taux d&apos;annulation</div></div>
        <div className="card stat"><div className="v">{customers}</div><div className="l">Clients acheteurs</div></div>
      </div>

      <h2>Exporter (Excel / CSV, avec les filtres ci-dessus)</h2>
      <div className="row">
        {(scope === 'admin' ? EXPORTS_ADMIN : EXPORTS_STORE).map(([k, l]) => (
          <a key={k} className="btn secondary" href={`${basePath}/export/${k}?${qs}`}>{l}</a>
        ))}
      </div>

      <h2>Ventes payées par jour</h2>
      <div className="card" role="img" aria-label="Ventes payées par jour">
        {byDay.length === 0 ? <span className="muted">Aucune vente payée sur la période.</span> : byDay.map(([day, v]) => (
          <div key={day} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 110px', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <span className="muted">{day}</span>
            <div style={{ background: 'var(--primary)', height: 14, borderRadius: 4, width: `${(v.sum / maxDay) * 100}%`, minWidth: 2 }} />
            <span style={{ textAlign: 'right' }}>{usd(v.sum)} ({v.n})</span>
          </div>
        ))}
      </div>

      <div className="cols" style={{ marginTop: 12 }}>
        {scope === 'admin' ? (
          <div className="card"><b>Par magasin</b>{byStore.map(([k, v]) => <div key={k}>{k} — {usd(v.sum)} ({v.n})</div>)}</div>
        ) : null}
        <div className="card"><b>Par commune de livraison</b>{byCommune.map(([k, v]) => <div key={k}>{k} — {usd(v.sum)} ({v.n})</div>)}</div>
        <div className="card"><b>Par statut</b>{byStatus.map(([k, v]) => <div key={k}>{k} — {v.n}</div>)}</div>
      </div>
      {orders.length >= 5000 ? <p className="muted">Affichage limité aux 5 000 commandes les plus récentes : réduisez la période pour un rapport complet.</p> : null}
    </>
  );
}
