import Link from 'next/link';
import type { CSSProperties } from 'react';
import { BarList, Donut, MonthCalendar, SalesChart, usdCompact, type DayPoint } from '@/components/Charts';
import { Icon } from '@/components/icons';
import { Flash } from '@/components/Shell';
import { StoreMap, type MapStore } from '@/components/StoreMap';
import { requireStaff, scopeLabel, type Permission } from '@/lib/auth';
import { dateTime, PAY_FR, STATUS_FR, UNIT_FR, usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

interface Dash {
  today: string;
  from: string;
  kpi: {
    sales_usd: number; sales_prev_usd: number; paid: number; paid_prev: number; orders: number; orders_prev: number;
    orders_paid: number; delivered: number; in_progress: number; awaiting_payment: number; cancelled: number;
  };
  series: DayPoint[];
  calendar: { month: string; days: { d: string; n: number; delivered: number }[] };
  top_stores: { id: string; name: string; commune: string | null; sales: number; orders: number }[];
  top_products: { product_id: string; name: string; unit: string; qty: number; sales: number }[];
  zones: { commune: string; n: number }[];
  counts: Record<'stores_active' | 'stores_open' | 'stores_unverified' | 'stores_no_gps' | 'drivers_verified' | 'drivers_online'
    | 'drivers_pending' | 'customers' | 'customers_new' | 'products' | 'proofs_pending' | 'tickets_open' | 'low_stock', number>;
  recent: { id: string; order_number: string; status: string; payment_status: string; total_usd: number; created_at: string; store: string | null }[];
  map: MapStore[];
}

const kpiColor = (c: string) => ({ '--kpi': c }) as CSSProperties;
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function statusTone(s: string) {
  if (s === 'delivered' || s === 'completed') return 'ok';
  if (s === 'cancelled' || s === 'failed' || s === 'refunded') return 'bad';
  if (s === 'received') return 'warn';
  return 'info';
}
function payTone(s: string) {
  if (s === 'succeeded') return 'ok';
  if (s === 'pending' || s === 'processing') return 'warn';
  if (s === 'failed' || s === 'cancelled') return 'bad';
  return 'info';
}

function Trend({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return <span className="trend flat">= stable</span>;
  if (!prev) return <span className="trend up"><Icon name="up" size={13} /> nouveau</span>;
  const p = ((cur - prev) / prev) * 100;
  return (
    <span className={`trend ${p >= 0 ? 'up' : 'down'}`} title="Par rapport aux 30 jours précédents">
      <Icon name={p >= 0 ? 'up' : 'down'} size={13} /> {p >= 0 ? '+' : ''}{p.toFixed(0)}{' '}%
    </span>
  );
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff();
  const can = (p: Permission) => user.permissions.includes(p);
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? `${sp.m}-01` : null;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('admin_dashboard', { p_month: month });
  const d = data as Dash | null;

  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kinshasa' }));
  const hello = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const firstName = (user.full_name ?? '').trim().split(/\s+/)[0] || (user.isSuper ? 'Direction' : 'équipe');
  const zones = user.isSuper ? '' : [...new Set(user.scopes.map(scopeLabel))].join(' · ');

  if (!d) {
    return (
      <>
        <h1>{hello}, {firstName}</h1>
        <Flash ok={sp.ok} err={sp.err} />
        <div className="notice err">Tableau de bord indisponible : {error?.message ?? 'erreur inconnue'}.</div>
      </>
    );
  }

  const k = d.kpi;
  const c = d.counts;
  const finance = can('finance');
  const basket = k.paid ? k.sales_usd / k.paid : 0;
  const basketPrev = k.paid_prev ? k.sales_prev_usd / k.paid_prev : 0;

  const [cy, cm] = d.calendar.month.split('-').map(Number);
  const shift = (n: number) => {
    const dt = new Date(Date.UTC(cy, cm - 1 + n, 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const next = shift(1);

  const alerts = [
    can('drivers') ? { href: '/admin/livreurs', icon: 'truck', label: 'Dossiers de livreurs à vérifier', n: c.drivers_pending } : null,
    finance ? { href: '/admin/preuves', icon: 'receipt', label: 'Preuves de paiement à contrôler', n: c.proofs_pending } : null,
    can('support') ? { href: '/admin/messagerie?f=open', icon: 'chat', label: 'Discussions clients ouvertes', n: c.tickets_open } : null,
    can('stores') ? { href: '/admin/magasins', icon: 'pin', label: 'Adresses de magasins à vérifier', n: c.stores_unverified } : null,
    can('stores') ? { href: '/admin/magasins', icon: 'globe', label: 'Magasins sans position GPS', n: c.stores_no_gps } : null,
    can('stores') ? { href: '/admin/magasins', icon: 'box', label: 'Articles en stock bas (magasins)', n: c.low_stock } : null,
  ].filter((a): a is { href: string; icon: string; label: string; n: number } => !!a)
    .sort((a, b) => Number(b.n > 0) - Number(a.n > 0));

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>{hello}, {firstName}</h1>
          <p className="page-sub">
            Activité de Kin Marché du {day(d.from)} au {day(d.today)}{zones ? <> · zone : <b>{zones}</b></> : null}.
          </p>
        </div>
        <div className="row">
          {can('stores') ? <Link className="btn secondary" href="/admin/magasins"><Icon name="plus" size={16} /> Supermarché</Link> : null}
          {user.isSuper ? <Link className="btn secondary" href="/admin/agents"><Icon name="shield" size={16} /> Agents</Link> : null}
          {can('support') ? <Link className="btn" href="/admin/messagerie"><Icon name="chat" size={16} /> Messagerie</Link> : null}
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      {user.isSuper && c.stores_active === 0 ? (
        <div className="notice">Aucun supermarché actif. <Link href="/admin/magasins">Ajoutez les magasins officiels</Link> (saisie ou import CSV) pour ouvrir le catalogue aux clients.</div>
      ) : null}

      <div className="dash">
        {finance ? (
          <>
            <div className="card kpi span-3" style={kpiColor('var(--primary)')}>
              <div className="kpi-top"><span className="kpi-ico"><Icon name="wallet" /></span><Trend cur={k.sales_usd} prev={k.sales_prev_usd} /></div>
              <div className="v">{usd(k.sales_usd)}</div>
              <div className="l">Ventes confirmées · 30 jours</div>
              <div className="s">{k.paid} paiement(s) confirmé(s) par les prestataires</div>
            </div>
            <div className="card kpi span-3" style={kpiColor('var(--accent)')}>
              <div className="kpi-top"><span className="kpi-ico"><Icon name="cart" /></span><Trend cur={k.orders} prev={k.orders_prev} /></div>
              <div className="v">{k.orders}</div>
              <div className="l">Commandes passées · 30 jours</div>
              <div className="s">{k.in_progress} en cours · {k.awaiting_payment} en attente de paiement</div>
            </div>
            <div className="card kpi span-3" style={kpiColor('var(--accent-2)')}>
              <div className="kpi-top"><span className="kpi-ico"><Icon name="receipt" /></span><Trend cur={basket} prev={basketPrev} /></div>
              <div className="v">{usd(basket)}</div>
              <div className="l">Panier moyen payé</div>
              <div className="s">Montant moyen des commandes encaissées</div>
            </div>
            <div className="card kpi span-3" style={kpiColor('var(--green)')}>
              <div className="kpi-top"><span className="kpi-ico"><Icon name="truck" /></span></div>
              <div className="v">{k.orders_paid ? Math.round((k.delivered / k.orders_paid) * 100) : 0}{' '}%</div>
              <div className="l">Taux de livraison</div>
              <div className="s">{k.delivered} livrée(s) sur {k.orders_paid} commande(s) payée(s)</div>
            </div>
          </>
        ) : null}

        <div className="span-12 minis">
          {can('stores') || user.isSuper ? (
            <div className="card mini-stat"><span className="kpi-ico" style={kpiColor('var(--primary)')}><Icon name="store" /></span>
              <div><div className="v">{c.stores_active}</div><div className="l">Supermarchés actifs · {c.stores_open} ouverts</div></div></div>
          ) : null}
          {can('drivers') ? (
            <div className="card mini-stat"><span className="kpi-ico" style={kpiColor('var(--green)')}><Icon name="truck" /></span>
              <div><div className="v">{c.drivers_verified}</div><div className="l">Livreurs certifiés · {c.drivers_online} disponibles</div></div></div>
          ) : null}
          {can('users') ? (
            <div className="card mini-stat"><span className="kpi-ico" style={kpiColor('var(--accent)')}><Icon name="users" /></span>
              <div><div className="v">{c.customers}</div><div className="l">Clients · +{c.customers_new} en 30 jours</div></div></div>
          ) : null}
          {user.isSuper ? (
            <div className="card mini-stat"><span className="kpi-ico" style={kpiColor('var(--violet)')}><Icon name="box" /></span>
              <div><div className="v">{c.products}</div><div className="l">Produits actifs au catalogue</div></div></div>
          ) : null}
          {can('support') ? (
            <div className="card mini-stat"><span className="kpi-ico" style={kpiColor('var(--amber)')}><Icon name="chat" /></span>
              <div><div className="v">{c.tickets_open}</div><div className="l">Discussions à traiter</div></div></div>
          ) : null}
        </div>

        {finance ? (
          <>
            <div className="card span-8">
              <div className="card-title">
                <span>Ventes et commandes <span className="muted">· 30 derniers jours</span></span>
                <div className="legend">
                  <span><i style={{ background: 'var(--primary)' }} />Ventes confirmées</span>
                  <span><i style={{ background: 'color-mix(in srgb, var(--accent) 45%, transparent)' }} />Commandes passées</span>
                </div>
              </div>
              <SalesChart series={d.series} />
            </div>
            <div className="card span-4">
              <div className="card-title"><span>Calendrier des commandes</span><Icon name="calendar" /></div>
              <MonthCalendar month={d.calendar.month} days={d.calendar.days} today={d.today}
                prevHref={`/admin?m=${shift(-1)}`} nextHref={next <= d.today.slice(0, 7) ? `/admin?m=${next}` : null} />
            </div>
            <div className="card span-4">
              <div className="card-title"><span>Qualité de service <span className="muted">· 30 jours</span></span></div>
              <div className="donuts">
                <Donut value={k.orders_paid} total={k.orders} color="var(--accent)" label="Paiement" sub={`${k.orders_paid}/${k.orders} payées`} />
                <Donut value={k.delivered} total={k.orders_paid} color="var(--green)" label="Livraison" sub={`${k.delivered}/${k.orders_paid} livrées`} />
                <Donut value={k.cancelled} total={k.orders} color="var(--primary)" label="Annulation" sub={`${k.cancelled}/${k.orders} annulées`} />
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
                Une commande n’est comptée payée qu’après confirmation réelle du prestataire de paiement.
              </p>
            </div>
          </>
        ) : null}

        {can('stores') || user.isSuper ? (
          <div className={`card ${finance ? 'span-8' : 'span-12'}`}>
            <div className="card-title">
              <span>Carte des supermarchés <span className="muted">· {d.map.length} géolocalisé(s)</span></span>
              <div className="legend">
                <span><i style={{ background: 'var(--green)' }} />Ouvert</span>
                <span><i style={{ background: '#fff', border: '2px solid var(--primary)' }} />Fermé</span>
              </div>
            </div>
            {d.map.length ? (
              <StoreMap stores={d.map} linkBase="/admin/magasins" />
            ) : (
              <div className="mapbox map-empty">
                <div>
                  <Icon name="pin" size={28} />
                  <p>Aucun supermarché n’a encore de position GPS.</p>
                  <Link className="btn secondary" href="/admin/magasins">Renseigner les coordonnées</Link>
                </div>
              </div>
            )}
            {c.stores_no_gps ? <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>{c.stores_no_gps} magasin(s) actif(s) sans coordonnées GPS : ils n’apparaissent pas sur la carte.</p> : null}
          </div>
        ) : null}

        {finance ? (
          <>
            <div className="card span-4">
              <div className="card-title"><span>Meilleurs supermarchés</span><span className="muted">ventes 30 j</span></div>
              <BarList empty="Aucune vente confirmée sur la période."
                items={d.top_stores.map((s) => ({ key: s.id, label: s.name, sub: `${s.orders} cmd`, value: Number(s.sales), display: usdCompact(Number(s.sales)) }))} />
            </div>
            <div className="card span-4">
              <div className="card-title"><span>Produits les plus vendus</span><span className="muted">ventes 30 j</span></div>
              <BarList empty="Aucun produit vendu sur la période." color="var(--accent)"
                items={d.top_products.map((p) => ({ key: p.product_id, label: p.name, sub: `${nf.format(Number(p.qty))} ${UNIT_FR[p.unit] ?? p.unit}`, value: Number(p.sales), display: usdCompact(Number(p.sales)) }))} />
            </div>
            <div className="card span-4">
              <div className="card-title"><span>Zones de livraison</span><span className="muted">commandes 30 j</span></div>
              <BarList empty="Aucune commande sur la période." color="var(--accent-2)"
                items={d.zones.map((z) => ({ key: z.commune, label: z.commune, value: z.n, display: String(z.n) }))} />
            </div>
          </>
        ) : null}

        {alerts.length ? (
          <div className={`card ${finance ? 'span-4' : 'span-12'}`}>
            <div className="card-title"><span>À traiter</span><Icon name="alert" /></div>
            <div className="alerts">
              {alerts.map((a) => (
                <Link key={a.label} href={a.href} className={`alert-item${a.n ? ' hot' : ' done'}`}>
                  <Icon name={a.n ? a.icon : 'check'} />
                  <span>{a.label}</span>
                  <span className="n">{a.n}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {finance ? (
          <div className="card span-8">
            <div className="card-title"><span>Dernières commandes</span><Link href="/admin/rapports" className="muted">Rapports et exports →</Link></div>
            <div className="table-wrap">
              <table className="flat">
                <thead><tr><th>N°</th><th>Magasin</th><th>Statut</th><th>Paiement</th><th>Total</th><th>Date</th></tr></thead>
                <tbody>
                  {d.recent.map((o) => (
                    <tr key={o.id}>
                      <td><b>{o.order_number}</b></td>
                      <td>{o.store ?? '—'}</td>
                      <td><span className={`badge ${statusTone(o.status)}`}>{STATUS_FR[o.status] ?? o.status}</span></td>
                      <td><span className={`badge ${payTone(o.payment_status)}`}>{PAY_FR[o.payment_status] ?? o.payment_status}</span></td>
                      <td>{usd(o.total_usd)}</td>
                      <td className="muted">{dateTime(o.created_at)}</td>
                    </tr>
                  ))}
                  {!d.recent.length ? <tr><td colSpan={6} className="muted">Aucune commande pour le moment.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
