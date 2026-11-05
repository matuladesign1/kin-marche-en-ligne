import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Icon } from '@/components/icons';
import { Flash } from '@/components/Shell';
import { dateTime, usd } from '@/lib/format';
import { CARD_STATUS_FR, EVENT_FR, SOURCE_FR, TIERS, TIER_FR, TX_FR, loyaltyError, points } from '@/lib/loyalty';
import { supabaseServer } from '@/lib/supabase-server';
import {
  adjustPointsAction, noAction, reactivateAction, relinkAction, setTierAction, suspendAction, unlinkAction, verifyLinkAction,
} from './actions';

// Pages « Cartes fidélité », partagées entre l'administration générale (/admin/fidelite)
// et les administrateurs de supermarché (/magasin/fidelite).

type SP = Record<string, string | undefined>;
const kpi = (c: string) => ({ '--kpi': c }) as CSSProperties;

/** Aperçu de la carte (mêmes couleurs que dans l'application). */
export function CardVisual({ tier, name, number, phone, suspended, pts }: {
  tier: string; name: string | null; number: string | null; phone?: string | null; suspended?: boolean; pts?: number;
}) {
  const has = !!number && tier !== 'none';
  return (
    <div className={`kmf-card kmf-${has ? tier : 'none'}`}>
      <div className="kmf-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/km-fidelite-logo.png" alt="Kin Marché" />
      </div>
      <div className="kmf-bar" />
      <div className="kmf-body">
        <span className="kmf-pill">{has ? `MEMBRE ${TIER_FR[tier].toUpperCase()}` : 'PAS ENCORE DE CARTE'}</span>
        {suspended ? <span className="kmf-flag">CARTE SUSPENDUE</span> : null}
        {name ? <span className="kmf-name">{name}</span> : null}
        <span className="kmf-num">{number ?? '243 ••• ••• •••'}</span>
        {phone ? <span className="kmf-phone">TÉLÉPHONE - {phone}</span> : null}
        {pts != null && has ? <span className="kmf-points">{points(pts)} points</span> : null}
      </div>
    </div>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return <span className={`tier ${TIERS.includes(tier as never) ? tier : 'none'}`}>{TIER_FR[tier] ?? tier}</span>;
}

function Tabs({ base, current, isSuper, toVerify, pending }: { base: string; current: string; isSuper: boolean; toVerify?: number; pending?: number | null }) {
  const tabs = [
    { href: base, key: 'cards', label: 'Cartes' },
    ...(isSuper ? [
      { href: `${base}/import`, key: 'import', label: 'Importer les membres' },
      { href: `${base}/operations`, key: 'ops', label: `Opérations à reporter${pending ? ` (${pending})` : ''}` },
      { href: `${base}/reglages`, key: 'settings', label: 'Réglages du programme' },
    ] : []),
  ];
  return (
    <div className="tabs">
      {tabs.map((t) => <a key={t.key} className={`btn ${t.key === current ? '' : 'secondary'}`} href={t.href}>{t.label}</a>)}
      {toVerify ? <a className="btn secondary" href={`${base}?status=to_verify`}>Liaisons à vérifier ({toVerify})</a> : null}
    </div>
  );
}

export async function LoyaltyHeader({ base, current, isSuper }: { base: string; current: string; isSuper: boolean }) {
  const sb = await supabaseServer();
  const { data } = await sb.rpc('admin_loyalty_overview');
  return (
    <>
      <h1>Cartes Kin Marché Fidélité</h1>
      <p className="page-sub">Carte Argent dès un premier achat payé de 16 000 FC ; Gold et Platinum sur décision de l&apos;administration.
        Le numéro de carte est le numéro de téléphone du client.</p>
      <Tabs base={base} current={current} isSuper={isSuper} toVerify={data?.links_to_verify} pending={data?.sync_pending} />
    </>
  );
}

const STATUS_FILTERS: Record<string, string> = {
  '': 'Toutes les cartes', active: 'Actives', suspended: 'Suspendues', to_verify: 'Liaisons à vérifier',
  eligible: 'Qualifiés sans téléphone', none: 'Clients sans carte (recherche)',
};

/** Liste des cartes avec recherche, filtres et indicateurs. */
export async function LoyaltyCards({ base, sp, isSuper }: { base: string; sp: SP; isSuper: boolean }) {
  const sb = await supabaseServer();
  const q = sp.q?.trim() || null;
  const tier = TIERS.includes(sp.tier as never) ? sp.tier! : null;
  const status = sp.status && sp.status in STATUS_FILTERS ? sp.status : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = 50;
  const [ov, list] = await Promise.all([
    sb.rpc('admin_loyalty_overview'),
    sb.rpc('admin_loyalty_cards', { p_search: q, p_tier: tier, p_status: status || null, p_limit: limit, p_offset: (page - 1) * limit }),
  ]);
  if (ov.error || list.error) return <div className="notice err">{loyaltyError((ov.error ?? list.error)!.message)}</div>;
  const o = ov.data as Record<string, any>;
  const rows = (list.data?.rows ?? []) as any[];
  const total = Number(list.data?.total ?? 0);
  const value = Number(o.points_outstanding) * Number(o.settings?.point_value_usd ?? 0.01);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (tier) u.set('tier', tier);
    if (status) u.set('status', status);
    u.set('page', String(p));
    return `${base}?${u.toString()}`;
  };

  return (
    <>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card kpi" style={kpi('var(--primary)')}><div className="l">Cartes actives</div><div className="v">{points(o.active)}</div>
          <div className="s">{points(o.members)} cartes · {points(o.suspended)} suspendue(s)</div></div>
        <div className="card kpi" style={kpi('#9B9FA6')}><div className="l">Argent · Gold · Platinum</div>
          <div className="v" style={{ fontSize: 24 }}>{points(o.silver)} · {points(o.gold)} · {points(o.platinum)}</div>
          <div className="s">{points(o.issued_30d)} carte(s) émise(s) en 30 jours</div></div>
        <div className="card kpi" style={kpi('var(--accent)')}><div className="l">Points en circulation</div><div className="v">{points(o.points_outstanding)}</div>
          <div className="s">≈ {usd(value)} · {points(o.points_earned_30d)} gagnés en 30 jours</div></div>
        <div className="card kpi" style={kpi('var(--accent-2)')}><div className="l">Membres Kin Marché Fidélité importés</div><div className="v">{points(o.program_members)}</div>
          <div className="s">{points(o.linked)} relié(s) · {points(o.links_to_verify)} à vérifier · {points(o.program_members_unlinked)} sans compte</div></div>
      </div>

      <form className="card row" method="get" action={base} style={{ marginBottom: 12 }}>
        <label style={{ flex: 2, minWidth: 220 }}>Rechercher (nom, téléphone, numéro de carte{isSuper ? ', e-mail' : ''})
          <input name="q" defaultValue={q ?? ''} placeholder="0812345678, 243…, nom" /></label>
        <label>Niveau
          <select name="tier" defaultValue={tier ?? ''}>
            <option value="">Tous</option>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_FR[t]}</option>)}
          </select></label>
        <label>Statut
          <select name="status" defaultValue={status ?? ''}>
            {Object.entries(STATUS_FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <button type="submit"><Icon name="search" /> Rechercher</button>
      </form>

      <p className="muted" style={{ margin: '0 0 8px' }}>{total} résultat(s){q ? ` pour « ${q} »` : ''}. Pour émettre une carte à un client qui n&apos;en a pas, recherchez-le par son nom ou son téléphone.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Client</th><th>Carte</th><th>Niveau</th><th>Statut</th><th style={{ textAlign: 'right' }}>Points</th><th>Origine</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td><b>{r.full_name ?? '—'}</b><div className="muted" style={{ fontSize: 12 }}>{r.phone ?? 'pas de téléphone'}{r.email ? ` · ${r.email}` : ''}</div></td>
                <td style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '.06em' }}>{r.card_number ?? '—'}</td>
                <td><TierBadge tier={r.card_status === 'none' ? 'none' : r.tier} /></td>
                <td>
                  <span className={`badge ${CARD_STATUS_FR[r.card_status]?.cls ?? ''}`}>{CARD_STATUS_FR[r.card_status]?.label ?? r.card_status}</span>
                  {r.linked && !r.link_verified ? <span className="badge warn" style={{ marginLeft: 4 }}>À vérifier</span> : null}
                  {r.enroll_eligible_at ? <span className="badge info" style={{ marginLeft: 4 }}>Qualifié</span> : null}
                </td>
                <td style={{ textAlign: 'right' }}><b>{points(r.points_balance)}</b>
                  {r.locked_points ? <div className="muted" style={{ fontSize: 12 }}>dont {points(r.locked_points)} bloqués</div> : null}</td>
                <td className="muted" style={{ fontSize: 13 }}>{r.enrollment_source ? SOURCE_FR[r.enrollment_source] : '—'}{r.card_issued_at ? <div>{dateTime(r.card_issued_at)}</div> : null}</td>
                <td><Link className="btn secondary" href={`${base}/${r.user_id}`}>Gérer</Link></td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={7} className="muted">Aucune carte ne correspond.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {total > limit ? (
        <div className="row" style={{ marginTop: 12 }}>
          {page > 1 ? <a className="btn secondary" href={qs(page - 1)}>Précédent</a> : null}
          <span className="muted">Page {page} / {Math.ceil(total / limit)}</span>
          {page * limit < total ? <a className="btn secondary" href={qs(page + 1)}>Suivant</a> : null}
        </div>
      ) : null}
    </>
  );
}

/** Fiche d'une carte : niveau, statut, points, liaison avec Kin Marché Fidélité, historique. */
export async function LoyaltyCardDetail({ base, id, sp }: { base: string; id: string; sp: SP }) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('admin_loyalty_card_detail', { p_user: id });
  if (error) return <><a href={base}>← Retour aux cartes</a><div className="notice err">{loyaltyError(error.message)}</div></>;
  const a = (data.account ?? {}) as Record<string, any>;
  const p = data.profile as Record<string, any>;
  const m = data.member as Record<string, any> | null;
  const o = data.orders as Record<string, any>;
  const has = a.card_status && a.card_status !== 'none';
  const hidden = <><input type="hidden" name="id" value={id} /><input type="hidden" name="base" value={base} /></>;

  return (
    <>
      <a href={base}>← Retour aux cartes</a>
      <h1 style={{ marginTop: 8 }}>{p.full_name ?? 'Client'}</h1>
      <p className="page-sub">{p.phone ?? 'Pas de téléphone'}{p.email ? ` · ${p.email}` : ''} · client depuis le {dateTime(p.created_at)}</p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="split">
        <div className="stack" style={{ display: 'grid', gap: 12 }}>
          <CardVisual tier={has ? a.tier : 'none'} name={p.full_name} number={a.card_number ?? p.phone_card_number}
            phone={p.phone_card_number} suspended={a.card_status === 'suspended'} pts={a.points_balance} />
          {!p.phone_card_number ? <div className="notice err">Pas de téléphone valide : la carte porte le numéro de téléphone du client (243 + 9 chiffres). Il doit l&apos;ajouter dans son profil.</div> : null}
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card">
            <h2>Carte</h2>
            <dl className="kv">
              <dt>Numéro</dt><dd>{a.card_number ?? '—'}</dd>
              <dt>Niveau</dt><dd>{has ? <TierBadge tier={a.tier} /> : 'Pas encore de carte'}</dd>
              <dt>Statut</dt><dd><span className={`badge ${CARD_STATUS_FR[a.card_status ?? 'none']?.cls}`}>{CARD_STATUS_FR[a.card_status ?? 'none']?.label}</span></dd>
              <dt>Points</dt><dd>{points(a.points_balance)}{a.locked_points ? ` (dont ${points(a.locked_points)} bloqués jusqu’à vérification)` : ''}</dd>
              <dt>Cumul</dt><dd>{points(a.lifetime_points)} points</dd>
              <dt>Origine</dt><dd>{a.enrollment_source ? SOURCE_FR[a.enrollment_source] : '—'}{a.card_issued_at ? ` · ${dateTime(a.card_issued_at)}` : ''}</dd>
              <dt>Commandes payées</dt><dd>{points(o?.paid)} · {usd(o?.total_usd)}{o?.last_paid_at ? ` · dernière le ${dateTime(o.last_paid_at)}` : ''}</dd>
              {a.enroll_eligible_at ? <><dt>Qualifié</dt><dd>Achat de 16 000 FC payé le {dateTime(a.enroll_eligible_at)} : carte émise dès que le téléphone sera valide</dd></> : null}
            </dl>
          </div>

          <form action={noAction} className="card stack" style={{ display: 'grid', gap: 10 }}>
            <h2 style={{ margin: 0 }}>{has ? 'Changer le niveau' : 'Émettre la carte'}</h2>
            {hidden}
            <div className="row">
              <label>Niveau
                <select name="tier" defaultValue={has ? a.tier : 'silver'}>
                  {TIERS.map((t) => <option key={t} value={t}>{TIER_FR[t]}</option>)}
                </select></label>
              <label style={{ flex: 1, minWidth: 200 }}>Motif (facultatif)<input name="note" placeholder="Client fidèle, gros volume d’achats…" /></label>
              <button formAction={setTierAction}><Icon name="star" /> {has ? 'Basculer' : 'Émettre la carte'}</button>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>Gold : +10 % de points bonus · Platinum : +25 %. Le client reçoit une notification.</span>
          </form>

          {has ? (
            <form action={noAction} className="card stack" style={{ display: 'grid', gap: 10 }}>
              <h2 style={{ margin: 0 }}>Points</h2>
              {hidden}
              <div className="row">
                <label>Points (+ ou −)<input name="points" inputMode="numeric" placeholder="+500 ou -200" required style={{ width: 150 }} /></label>
                <label style={{ flex: 1, minWidth: 200 }}>Motif (obligatoire)<input name="note" required placeholder="Geste commercial, correction…" /></label>
                <button formAction={adjustPointsAction}>Enregistrer</button>
              </div>
              <span className="muted" style={{ fontSize: 13 }}>Chaque ajustement est inscrit au journal et notifié au client.</span>
            </form>
          ) : null}

          {has ? (
            <form action={noAction} className="card row" style={{ alignItems: 'flex-end' }}>
              {hidden}
              <label style={{ flex: 1, minWidth: 200 }}>Motif (facultatif)<input name="note" /></label>
              {a.card_status === 'active'
                ? <button formAction={suspendAction} className="danger">Suspendre la carte</button>
                : <button formAction={reactivateAction}>Réactiver la carte</button>}
            </form>
          ) : null}

          <div className="card">
            <h2>Kin Marché Fidélité (magasins)</h2>
            {m ? (
              <>
                <dl className="kv">
                  <dt>Membre</dt><dd>{m.full_name ?? '—'} · {m.card_number}</dd>
                  <dt>Niveau en magasin</dt><dd><TierBadge tier={m.tier} /></dd>
                  <dt>Solde au dernier import</dt><dd>{points(m.points)} points · import du {dateTime(m.imported_at)}</dd>
                  <dt>Relié le</dt><dd>{dateTime(m.linked_at)} · {a.link_verified_at ? `vérifié le ${dateTime(a.link_verified_at)}` : 'à vérifier'}</dd>
                </dl>
                <form action={noAction} className="row" style={{ marginTop: 12 }}>
                  {hidden}
                  {!a.link_verified_at ? <button formAction={verifyLinkAction}><Icon name="check" /> Vérifier (débloquer {points(a.locked_points)} points)</button> : null}
                  <button formAction={unlinkAction} className="secondary">Délier</button>
                </form>
                {!a.link_verified_at ? <p className="muted" style={{ fontSize: 13 }}>Le téléphone saisi à l&apos;inscription n&apos;est pas vérifié par SMS : vérifiez l&apos;identité du client (carte physique, pièce d&apos;identité) avant de débloquer les points venus du magasin.</p> : null}
              </>
            ) : (
              <>
                <p className="muted">{a.link_blocked
                  ? 'Liaison retirée par l’administration : aucune liaison automatique tant qu’elle n’est pas autorisée à nouveau.'
                  : 'Aucun membre importé ne porte ce numéro. La carte sera reliée automatiquement dès que le membre sera importé.'}</p>
                {a.link_blocked ? (
                  <form action={noAction}>{hidden}<button formAction={relinkAction} className="secondary">Autoriser une nouvelle liaison</button></form>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>Mouvements de points</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Mouvement</th><th>Détail</th><th style={{ textAlign: 'right' }}>Points</th></tr></thead>
          <tbody>
            {(data.transactions as any[]).map((t) => (
              <tr key={t.id}>
                <td>{dateTime(t.created_at)}</td>
                <td>{TX_FR[t.type] ?? t.type}{t.source === 'program' ? <span className="badge info" style={{ marginLeft: 6 }}>Magasin</span> : null}</td>
                <td className="muted">{t.note}{t.order_number && !String(t.note ?? '').includes(t.order_number) ? ` · ${t.order_number}` : ''}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: t.points >= 0 ? 'var(--success)' : 'var(--danger)' }}>{t.points > 0 ? '+' : ''}{points(t.points)}</td>
              </tr>
            ))}
            {!(data.transactions as any[]).length ? <tr><td colSpan={4} className="muted">Aucun mouvement.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 24 }}>Journal de la carte</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Événement</th><th>Détail</th><th>Par</th></tr></thead>
          <tbody>
            {(data.events as any[]).map((e, i) => (
              <tr key={i}>
                <td>{dateTime(e.created_at)}</td>
                <td>{EVENT_FR[e.kind] ?? e.kind}</td>
                <td className="muted">{eventDetail(e.kind, e.details ?? {})}</td>
                <td className="muted">{e.actor ?? 'Système'}</td>
              </tr>
            ))}
            {!(data.events as any[]).length ? <tr><td colSpan={4} className="muted">Aucun événement.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function eventDetail(kind: string, d: Record<string, any>): string {
  switch (kind) {
    case 'issued': return `${TIER_FR[d.tier] ?? d.tier} · ${SOURCE_FR[d.source] ?? d.source}`;
    case 'tier_changed': return `${TIER_FR[d.from] ?? d.from} → ${TIER_FR[d.to] ?? d.to}${d.source === 'program' ? ' (magasin)' : ''}${d.note ? ` · ${d.note}` : ''}`;
    case 'points_adjusted': return `${d.points > 0 ? '+' : ''}${d.points} · ${d.note ?? ''}`;
    case 'linked': return `Membre ${TIER_FR[d.member_tier] ?? d.member_tier}, ${points(d.member_points)} points${d.review ? ' (à vérifier)' : ''}`;
    case 'link_verified': return `${points(d.unlocked_points)} points débloqués`;
    case 'unlinked': return `${points(d.removed_points)} points retirés${d.card_withdrawn ? ', carte retirée' : ''}`;
    case 'enroll_blocked': return d.reason === 'PHONE_REQUIRED' ? 'Pas de téléphone valide' : d.reason === 'CARD_NUMBER_TAKEN' ? 'Numéro déjà utilisé par une autre carte' : String(d.reason ?? '');
    case 'suspended': case 'reactivated': return d.note ?? '';
    default: return '';
  }
}
