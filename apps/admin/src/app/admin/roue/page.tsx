import {
  deletePrizeAction, grantSpinsAction, rewardAction, savePrizeAction, saveWheelSettingsAction,
} from '@/components/wheel/actions';
import { Flash } from '@/components/Shell';
import { requireSuper } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';
import {
  isoToKinLocal, KIND_FR, KIND_ORDER, prizeValue, REWARD_STATUS_FR, REWARD_STATUS_TONE, wheelError, wheelStateText, type WheelState,
} from '@/lib/wheel';

interface Prize {
  id: string; label: string; label_i18n: Record<string, string>; kind: string; value: number; product_id: string | null;
  product_name: string | null; quantity: number; min_order_usd: number; weight: number; stock: number | null; won_count: number;
  color: string; is_active: boolean; sort_order: number; drawable: boolean; chance: number | null;
}
interface Overview {
  settings: {
    enabled: boolean; min_order_usd: number; spins_per_order: number; spin_validity_days: number; coupon_validity_days: number;
    starts_at?: string | null; ends_at?: string | null;
  };
  state?: WheelState;
  prizes: Prize[];
  stats: Record<string, number>;
}
interface Reward {
  id: string; full_name: string | null; phone: string | null; email: string | null; kind: string; label: string; points: number | null;
  status: string; claim_code: string; coupon_code: string | null; coupon_used: boolean; product_name: string | null; quantity: number;
  order_number: string | null; store_name: string | null; note: string | null; created_at: string; handled_at: string | null;
}

type SP = { view?: string; ok?: string; err?: string; status?: string; kind?: string; q?: string; page?: string; edit?: string };
const PAGE = 50;

/** Aperçu de la roue telle que les clients la voient (mêmes couleurs, même ordre). */
function WheelPreview({ prizes }: { prizes: Prize[] }) {
  const list = prizes.filter((p) => p.drawable);
  const n = Math.max(list.length, 1);
  const C = 120;
  const R = 110;
  const pt = (deg: number, r = R) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)];
  return (
    <svg viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Aperçu de la roue">
      <circle cx={C} cy={C} r={R + 8} fill="#B5241F" />
      {list.length === 0 ? <circle cx={C} cy={C} r={R} fill="#E3E6EB" /> : list.length === 1 ? <circle cx={C} cy={C} r={R} fill={list[0].color} /> : list.map((p, i) => {
        const [x0, y0] = pt((360 / n) * i);
        const [x1, y1] = pt((360 / n) * (i + 1));
        return <path key={p.id} d={`M${C} ${C} L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`} fill={p.color} stroke="#fff" strokeWidth="2" />;
      })}
      {list.map((p, i) => {
        const mid = (360 / n) * (i + 0.5);
        return (
          <text key={`t${p.id}`} x={C} y={C - R * 0.64} fill="#fff" fontSize="11" fontWeight="700" textAnchor="middle"
            transform={`rotate(${mid} ${C} ${C})`}>{p.label.length > 14 ? `${p.label.slice(0, 13)}…` : p.label}</text>
        );
      })}
      <circle cx={C} cy={C} r="22" fill="#fff" stroke="#B5241F" strokeWidth="4" />
      <polygon points={`${C - 10},2 ${C + 10},2 ${C},26`} fill="#16181D" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

function PrizeForm({ prize, products }: { prize?: Prize; products: { id: string; name: string; sku: string }[] }) {
  return (
    <form action={savePrizeAction} className="card stack" id="lot">
      <h2 style={{ margin: 0 }}>{prize ? `Modifier le lot « ${prize.label} »` : 'Ajouter un lot'}</h2>
      {prize ? <input type="hidden" name="id" value={prize.id} /> : null}
      <div className="cols">
        <label>Libellé affiché sur la roue (français, 40 caractères)
          <input name="label" maxLength={40} required defaultValue={prize?.label ?? ''} placeholder="ex. 100 points, -10 %, Huile 1 L" /></label>
        <label>Type de lot
          <select name="kind" defaultValue={prize?.kind ?? 'points'}>
            {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_FR[k]}</option>)}
          </select></label>
        <label>Valeur (points, % ou $)
          <input name="value" inputMode="decimal" defaultValue={prize ? String(prize.value) : '50'} /></label>
        <label>Produit offert (type « Cadeau »)
          <select name="product_id" defaultValue={prize?.product_id ?? ''}>
            <option value="">—</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select></label>
        <label>Quantité offerte
          <input name="quantity" inputMode="numeric" defaultValue={prize?.quantity ?? 1} /></label>
        <label>Achat minimum pour utiliser le code ($)
          <input name="min_order_usd" inputMode="decimal" defaultValue={prize?.min_order_usd ?? 0} /></label>
        <label>Poids (chances relatives)
          <input name="weight" inputMode="decimal" required defaultValue={prize?.weight ?? 10} /></label>
        <label>Stock restant (vide = illimité)
          <input name="stock" inputMode="numeric" defaultValue={prize?.stock ?? ''} /></label>
        <label>Couleur du segment
          <input name="color" type="color" defaultValue={prize?.color ?? '#DE3530'} style={{ padding: 4 }} /></label>
        <label>Ordre sur la roue
          <input name="sort_order" inputMode="numeric" defaultValue={prize?.sort_order ?? 10} /></label>
      </div>
      <div className="cols">
        <label>Libellé en anglais (facultatif)<input name="label_en" maxLength={40} defaultValue={prize?.label_i18n?.en ?? ''} /></label>
        <label>Libellé en lingala (facultatif)<input name="label_ln" maxLength={40} defaultValue={prize?.label_i18n?.ln ?? ''} /></label>
        <label>Libellé en kiswahili (facultatif)<input name="label_sw" maxLength={40} defaultValue={prize?.label_i18n?.sw ?? ''} /></label>
      </div>
      <label className="check"><input type="checkbox" name="is_active" defaultChecked={prize ? prize.is_active : true} /> Lot actif (présent sur la roue)</label>
      <div className="row">
        <button type="submit">{prize ? 'Enregistrer le lot' : 'Ajouter le lot'}</button>
        {prize ? <a className="btn secondary" href="/admin/roue#lot">Annuler</a> : null}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        La chance d’un lot = son poids ÷ total des poids des lots actifs. Un code promo gagné est personnel, utilisable une fois ;
        un cadeau est joint gratuitement à la prochaine commande payée du client (le supermarché le voit dans la commande).
      </p>
    </form>
  );
}

export default async function RoueAdmin({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSuper();
  const sp = await searchParams;
  const view = sp.view === 'gains' ? 'gains' : sp.view === 'offrir' ? 'offrir' : 'lots';
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('admin_wheel_overview');
  if (error) {
    return (
      <>
        <h1>Roue de la chance</h1>
        <div className="notice err">{wheelError(error.message)}</div>
      </>
    );
  }
  const o = data as Overview;
  const s = o.stats;
  const status = wheelStateText(o.state ?? (o.settings.enabled ? 'active' : 'off'), o.settings.starts_at, o.settings.ends_at);
  const giftsToHandle = (s.gifts_pending ?? 0) + (s.gifts_attached ?? 0);

  const tabs = [
    { key: 'lots', href: '/admin/roue', label: 'Lots et réglages' },
    { key: 'gains', href: '/admin/roue?view=gains', label: `Gains des clients${giftsToHandle ? ` (${giftsToHandle} cadeau${giftsToHandle > 1 ? 'x' : ''} à remettre)` : ''}` },
    { key: 'offrir', href: '/admin/roue?view=offrir', label: 'Offrir des tours' },
  ];

  const kpis = [
    { l: 'Tours accordés', v: s.spins_granted, sub: `${s.spins_available} disponibles` },
    { l: 'Tours joués', v: s.spins_used, sub: `${s.spins_30d} sur 30 jours · ${s.players} joueurs` },
    { l: 'Points distribués', v: s.points_awarded, sub: 'crédités sur les cartes' },
    { l: 'Codes promo', v: s.coupons_issued, sub: `${s.coupons_used} utilisés` },
    { l: 'Cadeaux à remettre', v: giftsToHandle, sub: `${s.gifts_delivered} remis` },
  ];

  let body: React.ReactNode = null;
  if (view === 'lots') {
    const products = ((await sb.from('products').select('id, name, sku').eq('is_active', true).order('name').limit(1500)).data ?? []) as { id: string; name: string; sku: string }[];
    const editing = sp.edit ? o.prizes.find((p) => p.id === sp.edit) : undefined;
    const st = o.settings;
    body = (
      <>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
          <form action={saveWheelSettingsAction} className="card stack">
            <h2 style={{ margin: 0 }}>Réglages</h2>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={st.enabled} /> Roue de la chance activée dans l’application</label>
            <div className="cols">
              <label>Date de début (facultatif)
                <input type="datetime-local" name="starts_at" defaultValue={isoToKinLocal(st.starts_at)} /></label>
              <label>Date de fin (facultatif)
                <input type="datetime-local" name="ends_at" defaultValue={isoToKinLocal(st.ends_at)} /></label>
            </div>
            <p className="muted" style={{ margin: '-4px 0 0', fontSize: 13 }}>
              Heure de Kinshasa. Laissez vide pour une roue sans limite. Avant le début et après la fin, la roue disparaît
              de l’application, les achats ne donnent plus de tours et les tours non joués ne peuvent plus être utilisés.
              Les cadeaux déjà gagnés restent dus.
            </p>
            <div className="cols">
              <label>Achat payé minimum pour gagner un tour ($)
                <input name="min_order_usd" inputMode="decimal" required defaultValue={st.min_order_usd} /></label>
              <label>Tours offerts par commande
                <input name="spins_per_order" inputMode="numeric" required defaultValue={st.spins_per_order} /></label>
              <label>Validité d’un tour (jours)
                <input name="spin_validity_days" inputMode="numeric" required defaultValue={st.spin_validity_days} /></label>
              <label>Validité des codes promo gagnés (jours)
                <input name="coupon_validity_days" inputMode="numeric" required defaultValue={st.coupon_validity_days} /></label>
            </div>
            <div className="row"><button type="submit">Enregistrer les réglages</button></div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Le tour est offert dès que le paiement de la commande est confirmé. Si la commande est annulée ou remboursée,
              ses tours non joués et les gains obtenus avec eux sont retirés automatiquement.
            </p>
          </form>
          <div className="card" style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
            <WheelPreview prizes={o.prizes} />
            <span className="muted" style={{ fontSize: 13 }}>Aperçu : lots actifs, dans l’ordre de la roue</span>
          </div>
        </div>

        <h2>Lots ({o.prizes.length})</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ordre</th><th>Lot</th><th>Type</th><th>Valeur</th><th>Poids</th><th>Chance</th><th>Stock</th><th>Gagnés</th><th>État</th><th></th></tr></thead>
            <tbody>
              {o.prizes.map((p) => (
                <tr key={p.id}>
                  <td>{p.sort_order}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 14, height: 14, borderRadius: 4, background: p.color, display: 'inline-block' }} />
                      <b>{p.label}</b>
                    </span>
                    {Object.values(p.label_i18n ?? {}).filter(Boolean).length ? (
                      <div className="muted" style={{ fontSize: 12 }}>{Object.entries(p.label_i18n).map(([k, v]) => `${k} : ${v}`).join(' · ')}</div>
                    ) : null}
                  </td>
                  <td>{KIND_FR[p.kind] ?? p.kind}</td>
                  <td>{prizeValue(p)}</td>
                  <td>{p.weight}</td>
                  <td>{p.chance != null ? `${p.chance} %` : '—'}</td>
                  <td>{p.stock == null ? 'Illimité' : p.stock}</td>
                  <td>{p.won_count}</td>
                  <td>
                    {!p.is_active ? <span className="badge">Désactivé</span>
                      : !p.drawable ? <span className="badge warn">{p.stock === 0 ? 'Épuisé' : 'Non tirable'}</span>
                        : <span className="badge ok">Sur la roue</span>}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <a className="btn secondary" href={`/admin/roue?edit=${p.id}#lot`}>Modifier</a>
                      <form action={deletePrizeAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="secondary" type="submit">{p.won_count > 0 ? 'Désactiver' : 'Supprimer'}</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 16 }}>
          <PrizeForm key={editing?.id ?? 'new'} prize={editing} products={products} />
        </div>
      </>
    );
  } else if (view === 'gains') {
    const page = Math.max(Number(sp.page ?? 1) || 1, 1);
    const status = sp.status ?? '';
    const kind = sp.kind ?? '';
    const q = sp.q ?? '';
    const { data: rw, error: e2 } = await sb.rpc('admin_wheel_rewards', {
      p_status: status || null, p_kind: kind || null, p_search: q || null, p_limit: PAGE, p_offset: (page - 1) * PAGE,
    });
    const res = (rw ?? { total: 0, rows: [] }) as { total: number; rows: Reward[] };
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (kind) qs.set('kind', kind);
    if (q) qs.set('q', q);
    const pages = Math.max(Math.ceil(res.total / PAGE), 1);
    const link = (p: number) => `/admin/roue?view=gains&${qs.toString()}${qs.toString() ? '&' : ''}page=${p}`;
    body = (
      <>
        {e2 ? <div className="notice err">{wheelError(e2.message)}</div> : null}
        <form className="card row" method="get" action="/admin/roue">
          <input type="hidden" name="view" value="gains" />
          <label>État
            <select name="status" defaultValue={status}>
              <option value="">Tous</option>
              {Object.entries(REWARD_STATUS_FR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label>Type
            <select name="kind" defaultValue={kind}>
              <option value="">Tous</option>
              <option value="points">Points</option>
              <option value="coupon">Codes promo</option>
              <option value="product">Cadeaux</option>
              <option value="extra_spin">Tours supplémentaires</option>
            </select></label>
          <label style={{ flex: 1, minWidth: 220 }}>Recherche (client, téléphone, code, commande)
            <input name="q" defaultValue={q} placeholder="Nom, e-mail, 08…, ROUE-…, KM-…" /></label>
          <button type="submit">Filtrer</button>
          <a className="btn secondary" href="/admin/roue?view=gains&status=pending">Cadeaux à remettre</a>
        </form>
        <p className="muted">{res.total} gain(s)</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Client</th><th>Gain</th><th>Code</th><th>État</th><th>Commande</th><th></th></tr></thead>
            <tbody>
              {res.rows.map((r) => {
                const isCoupon = r.kind === 'coupon_percent' || r.kind === 'coupon_fixed';
                return (
                  <tr key={r.id}>
                    <td>{dateTime(r.created_at)}</td>
                    <td><b>{r.full_name ?? '—'}</b><div className="muted" style={{ fontSize: 12 }}>{[r.phone, r.email].filter(Boolean).join(' · ')}</div></td>
                    <td>{r.label}<div className="muted" style={{ fontSize: 12 }}>{KIND_FR[r.kind] ?? r.kind}{r.kind === 'product' && r.product_name ? ` · ${r.quantity} × ${r.product_name}` : ''}</div></td>
                    <td style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {isCoupon ? <>{r.coupon_code}{r.coupon_used ? <div className="muted" style={{ fontSize: 12 }}>utilisé</div> : null}</> : r.kind === 'product' ? r.claim_code : '—'}
                    </td>
                    <td><span className={`badge ${REWARD_STATUS_TONE[r.status] ?? ''}`}>{REWARD_STATUS_FR[r.status] ?? r.status}</span>
                      {r.note ? <div className="muted" style={{ fontSize: 12, maxWidth: 220 }}>{r.note}</div> : null}</td>
                    <td>{r.order_number ? <>{r.order_number}<div className="muted" style={{ fontSize: 12 }}>{r.store_name}</div></> : '—'}</td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        {r.kind === 'product' && ['pending', 'attached'].includes(r.status) ? (
                          <form action={rewardAction}>
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="deliver" />
                            <input type="hidden" name="qs" value={qs.toString()} />
                            <button type="submit">Remis</button>
                          </form>
                        ) : null}
                        {r.status === 'attached' ? (
                          <form action={rewardAction}>
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="reset" />
                            <input type="hidden" name="qs" value={qs.toString()} />
                            <button className="secondary" type="submit">Remettre en attente</button>
                          </form>
                        ) : null}
                        {['pending', 'attached', 'issued'].includes(r.status) && !(isCoupon && r.coupon_used) ? (
                          <form action={rewardAction}>
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="cancel" />
                            <input type="hidden" name="qs" value={qs.toString()} />
                            <button className="secondary" type="submit">Annuler</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!res.rows.length ? <tr><td colSpan={7} className="muted">Aucun gain pour ces filtres.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="row" style={{ marginTop: 12 }}>
            {page > 1 ? <a className="btn secondary" href={link(page - 1)}>← Précédent</a> : null}
            <span className="muted">Page {page} / {pages}</span>
            {page < pages ? <a className="btn secondary" href={link(page + 1)}>Suivant →</a> : null}
          </div>
        ) : null}
      </>
    );
  } else {
    body = (
      <form action={grantSpinsAction} className="card stack" style={{ maxWidth: 640 }}>
        <h2 style={{ margin: 0 }}>Offrir des tours à un client</h2>
        <p className="muted" style={{ margin: 0 }}>Geste commercial, concours ou dédommagement : le client reçoit une notification et joue depuis l’application.</p>
        <div className="cols">
          <label>E-mail ou téléphone du client
            <input name="customer" required placeholder="client@exemple.cd ou 08x xxx xxxx" /></label>
          <label>Nombre de tours
            <input name="count" inputMode="numeric" required defaultValue={1} /></label>
        </div>
        <label>Motif (visible dans l’historique)
          <input name="note" maxLength={200} placeholder="ex. Jeu concours Saint-Valentin" /></label>
        <div className="row"><button type="submit">Offrir les tours</button></div>
      </form>
    );
  }

  return (
    <>
      <h1>Roue de la chance</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Un tour est offert pour chaque commande payée d’au moins {o.settings.min_order_usd} $.
      </p>
      <p style={{ marginTop: -4 }}>
        <span className={`badge ${status.tone}`}>{status.text}</span>
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="tabs">
        {tabs.map((t) => <a key={t.key} className={`btn ${t.key === view ? '' : 'secondary'}`} href={t.href}>{t.label}</a>)}
      </div>
      <div className="grid" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.l} className="card kpi">
            <div className="l">{k.l}</div>
            <div className="v">{new Intl.NumberFormat('fr-FR').format(Number(k.v ?? 0))}</div>
            <div className="s">{k.sub}</div>
          </div>
        ))}
      </div>
      {body}
    </>
  );
}
