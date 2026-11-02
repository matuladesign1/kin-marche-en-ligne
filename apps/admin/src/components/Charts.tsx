import Link from 'next/link';

// Graphiques du tableau de bord, dessinés en SVG côté serveur (aucune bibliothèque).

const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
export const usdCompact = (v: number) => `${compact.format(v)} $`;

function niceMax(v: number) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/** Courbe lissée (Catmull-Rom → Bézier), bornée pour ne jamais passer sous l'axe. */
function smoothPath(pts: [number, number][], top: number, bottom: number) {
  if (!pts.length) return '';
  const f = (n: number) => n.toFixed(1);
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])},${f(p[1])}`).join(' ');
  const clamp = (y: number) => Math.min(bottom, Math.max(top, y));
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export interface DayPoint { d: string; orders: number; sales: number; paid: number }

/** Ventes confirmées (courbe) et commandes passées (barres) sur 30 jours. */
export function SalesChart({ series }: { series: DayPoint[] }) {
  const W = 720, H = 260, L = 58, R = 42, T = 16, B = 30;
  const w = W - L - R, h = H - T - B, bottom = T + h;
  const n = series.length;
  const maxS = niceMax(Math.max(0, ...series.map((s) => Number(s.sales))));
  const maxO = niceMax(Math.max(0, ...series.map((s) => Number(s.orders))));
  const step = n > 1 ? w / (n - 1) : 0;
  const x = (i: number) => L + i * step;
  const yS = (v: number) => bottom - (v / maxS) * h;
  const yO = (v: number) => bottom - (v / maxO) * h;
  const pts = series.map((s, i) => [x(i), yS(Number(s.sales))] as [number, number]);
  const line = smoothPath(pts, T, bottom);
  const area = pts.length ? `${line} L${x(n - 1).toFixed(1)},${bottom} L${x(0).toFixed(1)},${bottom} Z` : '';
  const barW = Math.max(4, Math.min(12, step * 0.45));
  const lastPt = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Ventes confirmées et commandes des 30 derniers jours">
      <defs>
        <linearGradient id="km-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--primary)', stopOpacity: 0.26 }} />
          <stop offset="100%" style={{ stopColor: 'var(--primary)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = bottom - t * h;
        return (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y} y2={y} className="grid-line" />
            <text x={L - 8} y={y + 4} textAnchor="end" className="axis">{usdCompact(maxS * t)}</text>
            <text x={W - R + 8} y={y + 4} className="axis">{Math.round(maxO * t)}</text>
          </g>
        );
      })}
      {series.map((s, i) => (s.orders > 0 ? (
        <rect key={`b${s.d}`} x={x(i) - barW / 2} y={yO(s.orders)} width={barW} height={bottom - yO(s.orders)} rx={3} className="bar" />
      ) : null))}
      <path d={area} style={{ fill: 'url(#km-area)' }} />
      <path d={line} fill="none" style={{ stroke: 'var(--primary)' }} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      {lastPt ? <circle cx={lastPt[0]} cy={lastPt[1]} r={5} className="dot" /> : null}
      {series.map((s, i) => ((i % 5 === 0 && i < n - 3) || i === n - 1 ? (
        <text key={`x${s.d}`} x={x(i)} y={H - 8} textAnchor="middle" className="axis">{shortDay(s.d)}</text>
      ) : null))}
      {series.map((s, i) => (
        <rect key={`h${s.d}`} x={x(i) - Math.max(step, 8) / 2} y={T} width={Math.max(step, 8)} height={h} className="hover-col">
          <title>{`${shortDay(s.d)} — ${s.orders} commande(s) passée(s), ${s.paid} payée(s), ${usdCompact(Number(s.sales))} encaissés`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Anneau de progression (pourcentage). */
export function Donut({ value, total, color, label, sub }: { value: number; total: number; color: string; label: string; sub: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <div className="donut">
      <svg viewBox="0 0 100 100" width={108} height={108} role="img" aria-label={`${label} : ${pct} %`}>
        <circle cx={50} cy={50} r={r} fill="none" style={{ stroke: 'var(--surface-alt)' }} strokeWidth={11} />
        {pct > 0 ? (
          <circle cx={50} cy={50} r={r} fill="none" style={{ stroke: color }} strokeWidth={11} strokeLinecap="round"
            strokeDasharray={`${((c * pct) / 100).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 50 50)" />
        ) : null}
        <text x={50} y={56} textAnchor="middle" className="donut-v">{pct}{' '}%</text>
      </svg>
      <div className="donut-label">{label}</div>
      <div className="donut-sub">{sub}</div>
    </div>
  );
}

/** Calendrier du mois : intensité selon le nombre de commandes passées. */
export function MonthCalendar({ month, days, today, prevHref, nextHref }: {
  month: string; days: { d: string; n: number; delivered: number }[]; today: string; prevHref: string; nextHref: string | null;
}) {
  const first = new Date(`${month}T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7; // lundi en premier
  const max = Math.max(1, ...days.map((x) => x.n));
  const title = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div>
      <div className="cal-head">
        <Link href={prevHref} aria-label="Mois précédent" scroll={false}>‹</Link>
        <span>{title}</span>
        {nextHref ? <Link href={nextHref} aria-label="Mois suivant" scroll={false}>›</Link> : <span style={{ opacity: 0.3 }}>›</span>}
      </div>
      <div className="cal">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <div key={`h${i}`} className="h">{d}</div>)}
        {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} />)}
        {days.map((x) => {
          const k = x.n ? 0.18 + 0.72 * (x.n / max) : 0;
          const label = new Date(`${x.d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
          return (
            <div key={x.d} className={`d${x.d === today ? ' today' : ''}${x.d > today ? ' future' : ''}`}
              style={x.n ? { background: `color-mix(in srgb, var(--primary) ${Math.round(k * 100)}%, transparent)`, color: k > 0.5 ? '#fff' : undefined, fontWeight: 700 } : undefined}
              title={`${label} : ${x.n} commande(s), ${x.delivered} livrée(s)`}>
              {Number(x.d.slice(8, 10))}
            </div>
          );
        })}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        <span><i style={{ background: 'color-mix(in srgb, var(--primary) 20%, transparent)' }} />Peu de commandes</span>
        <span><i style={{ background: 'var(--primary)' }} />Journée la plus active</span>
      </div>
    </div>
  );
}

export interface BarItem { key: string; label: string; value: number; display: string; sub?: string }

/** Classement en barres horizontales. */
export function BarList({ items, color = 'var(--primary)', empty }: { items: BarItem[]; color?: string; empty: string }) {
  if (!items.length) return <p className="muted" style={{ margin: 0 }}>{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((it, idx) => (
        <div key={it.key} className="row-b">
          <div className="top">
            <span className="lbl"><b className="rank">{idx + 1}</b>{it.label}{it.sub ? <span className="muted"> · {it.sub}</span> : null}</span>
            <b>{it.display}</b>
          </div>
          <div className="track"><div className="fill" style={{ width: `${Math.max(4, (it.value / max) * 100)}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}
