import Link from 'next/link';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { ConfirmButton } from '@/components/ConfirmButton';
import { CertifiedDriver, Icon } from '@/components/icons';
import { Flash } from '@/components/Shell';
import type { CurrentUser } from '@/lib/auth';
import { dateTime, STATUS_FR, usd } from '@/lib/format';
import { CATEGORY, GENDER, ID_TYPE, PASTRY_FILTERS, PASTRY_STATUS, ageOf, completion, desired } from '@/lib/pastry';
import {
  activateChefAction, cancelRequestAction, certifyChefAction, grantChefAction, messageCustomerAction, rejectRequestAction,
  revokeChefAction, saveSettingsAction, suspendChefAction, uncertifyChefAction,
} from '@/lib/pastry-actions';
import { supabaseServer } from '@/lib/supabase-server';

// Espace Pâtisserie : pâtissiers (accès, profil complet, certification, suspension), commandes pâtisserie
// des clients (suivi, refus, annulation, message), réglages. Commun à l'administration et aux supermarchés.

type Base = '/admin/patisserie' | '/magasin/patisserie';
type Sp = { tab?: string; f?: string; cf?: string; store?: string; id?: string; ok?: string; err?: string };

const CHEF_FILTERS: Record<string, string> = {
  review: 'À certifier', certified: 'Certifiés', active: 'Actifs', suspended: 'Suspendus', all: 'Tous',
};

function href(base: Base, params: Record<string, string | undefined>) {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
  return `${base}${q ? `?${q}` : ''}`;
}

/** Champs cachés communs : l'action revient sur la même vue. */
function Keep({ base, sp, tab, id }: { base: Base; sp: Sp; tab: string; id?: string }) {
  return (
    <>
      <input type="hidden" name="base" value={base} />
      <input type="hidden" name="tab" value={tab} />
      {sp.f ? <input type="hidden" name="f" value={sp.f} /> : null}
      {sp.cf ? <input type="hidden" name="cf" value={sp.cf} /> : null}
      {sp.store ? <input type="hidden" name="store" value={sp.store} /> : null}
      {id ? <input type="hidden" name="id" value={id} /> : null}
    </>
  );
}

export async function PastrySpace({ base, user, stores, sp }: { base: Base; user: CurrentUser; stores: { id: string; name: string }[]; sp: Sp }) {
  const sb = await supabaseServer();
  const tab = sp.tab === 'chefs' || (sp.tab === 'settings' && user.isSuper) ? sp.tab : 'orders';
  const storeIds = stores.map((s) => s.id);
  const store = stores.find((s) => s.id === sp.store) ?? null;
  const scope = store ? [store.id] : storeIds;
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? '—';

  // Chiffres clés.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [chefsRes, ordersRes, settingsRes] = await Promise.all([
    scope.length
      ? sb.from('pastry_chefs').select('*, profiles(full_name, email, phone, avatar_url, role, is_active)').in('store_id', scope).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    scope.length
      ? sb.from('cake_orders').select('id, status, quoted_price_usd, created_at, updated_at').in('store_id', scope).gte('created_at', new Date(Date.now() - 120 * 86_400_000).toISOString()).limit(5000)
      : Promise.resolve({ data: [] as any[] }),
    sb.from('app_settings').select('value').eq('key', 'pastry').maybeSingle(),
  ]);
  const chefs = (chefsRes.data ?? []) as any[];
  const recent = (ordersRes.data ?? []) as any[];
  const settings = { enabled: true, min_lead_hours: 3, ...((settingsRes.data?.value ?? {}) as Record<string, unknown>) } as { enabled: boolean; min_lead_hours: number };
  const activeChefs = chefs.filter((c) => c.status === 'active' && c.profiles?.role === 'pastry_chef');
  const toCertify = activeChefs.filter((c) => c.profile_completed_at && !c.certified);
  const delivered30 = recent.filter((o) => o.status === 'delivered' && o.updated_at >= since);
  const kpis = [
    { l: 'Pâtissiers actifs', v: String(activeChefs.length), s: `${activeChefs.filter((c) => c.certified).length} certifié(s)`, c: '#B92D61', i: 'chef' },
    { l: 'Profils à certifier', v: String(toCertify.length), s: user.isSuper ? 'Certification par l’administrateur général' : 'Vérifiés par Kin Marché', c: '#E2A45B', i: 'shield' },
    { l: 'Nouvelles demandes', v: String(recent.filter((o) => o.status === 'submitted').length), s: 'En attente d’un prix', c: '#E0457B', i: 'bell' },
    { l: 'À préparer', v: String(recent.filter((o) => ['paid', 'in_preparation'].includes(o.status)).length), s: 'Payées, en préparation', c: '#8B5CF6', i: 'cake' },
    { l: 'Livrées (30 jours)', v: String(delivered30.length), s: `${usd(delivered30.reduce((a, o) => a + Number(o.quoted_price_usd ?? 0), 0))} de pâtisserie`, c: '#13A35F', i: 'check' },
  ];

  const tabs = [
    { key: 'orders', label: 'Commandes pâtisserie' },
    { key: 'chefs', label: `Pâtissiers (${activeChefs.length})` },
    ...(user.isSuper ? [{ key: 'settings', label: 'Réglages' }] : []),
  ];

  let body: ReactNode = null;

  // ---------------------------------------------------------------- Commandes
  if (tab === 'orders') {
    const f = PASTRY_FILTERS[sp.f ?? ''] ? sp.f! : 'todo';
    const { data: rows } = scope.length
      ? await sb.from('cake_orders')
        .select('id, request_number, store_id, category, cake_type, full_name, phone, desired_at, status, quoted_price_usd, chef_id, order_number, order_status, created_at, pastry_chefs(display_name)')
        .in('store_id', scope).in('status', PASTRY_FILTERS[f].statuses)
        .order(f === 'todo' || f === 'prep' ? 'created_at' : 'updated_at', { ascending: f === 'todo' || f === 'prep' }).limit(200)
      : { data: [] as any[] };
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(PASTRY_FILTERS)) counts[k] = recent.filter((o) => v.statuses.includes(o.status)).length;

    // Détail d'une commande.
    let detail: ReactNode = null;
    if (sp.id) {
      const { data: o } = await sb.from('cake_orders').select('*, pastry_chefs(display_name, certified)').eq('id', sp.id).maybeSingle();
      if (o && scope.includes(o.store_id)) {
        const [{ data: msgs }, signed] = await Promise.all([
          sb.from('pastry_messages').select('id, sender_id, body, created_at').eq('cake_order_id', o.id).order('created_at', { ascending: true }).limit(200),
          o.reference_photo_path ? sb.storage.from('cake-references').createSignedUrl(o.reference_photo_path, 600) : Promise.resolve({ data: null }),
        ]);
        const st = PASTRY_STATUS[o.status] ?? { label: o.status, cls: '' };
        const facts: [string, string | number | null][] = [
          ['Catégorie', CATEGORY[o.category] ?? o.category], ['Désignation', o.cake_type], ['Taille', o.size], ['Parts', o.servings],
          ['Quantité', o.quantity], ['Saveur', o.flavor], ['Couleurs / décoration', o.color], ['Texte sur le gâteau', o.inscription],
          ['Souhaitée pour', desired(o.desired_at)], ['Supermarché', storeName(o.store_id)],
          ['Client', `${o.full_name} · ${o.phone}`], ['Pâtissier', o.pastry_chefs?.display_name ?? 'Pas encore attribuée'],
          ['Prix proposé', o.quoted_price_usd != null ? usd(o.quoted_price_usd) : null],
          ['Commande Kin Marché', o.order_number ? `${o.order_number} · ${STATUS_FR[o.order_status] ?? o.order_status ?? ''}` : null],
        ];
        detail = (
          <div className="card" style={{ marginBottom: 16, borderLeft: '5px solid #E0457B' }}>
            <div className="card-title">
              <span><Icon name="cake" /> {o.request_number} — {o.cake_type}</span>
              <span className={`badge ${st.cls}`}>{st.label}</span>
            </div>
            <dl className="kv">
              {facts.filter(([, v]) => v != null && v !== '').map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}
            </dl>
            {o.details ? <div className="notice" style={{ whiteSpace: 'pre-wrap' }}><b>Précisions du client :</b> {o.details}</div> : null}
            {o.quote_details ? <div className="notice" style={{ whiteSpace: 'pre-wrap' }}><b>Détails du prix :</b> {o.quote_details}</div> : null}
            {o.reject_reason ? <div className="notice err"><b>Motif :</b> {o.reject_reason}</div> : null}
            {signed?.data?.signedUrl ? (
              <a href={signed.data.signedUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={signed.data.signedUrl} alt="Photo de référence" style={{ maxWidth: 260, maxHeight: 220, borderRadius: 12, objectFit: 'cover', display: 'block', marginTop: 8 }} />
              </a>
            ) : null}

            <h3 style={{ marginBottom: 6 }}>Discussion avec le client</h3>
            {!msgs?.length ? <p className="muted" style={{ marginTop: 0 }}>Aucun message.</p> : (
              <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto', marginBottom: 8 }}>
                {msgs.map((m: any) => {
                  const fromCustomer = m.sender_id === o.customer_id;
                  return (
                    <div key={m.id} style={{ justifySelf: fromCustomer ? 'start' : 'end', maxWidth: '78%', background: fromCustomer ? 'var(--surface-alt)' : 'color-mix(in srgb, #E0457B 14%, transparent)', borderRadius: 12, padding: '6px 10px' }}>
                      <div className="muted" style={{ fontSize: 11 }}>{fromCustomer ? 'Client' : 'Pâtisserie'} · {dateTime(m.created_at)}</div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {!['delivered', 'cancelled', 'rejected'].includes(o.status) ? (
              <form action={messageCustomerAction} className="row">
                <Keep base={base} sp={sp} tab="orders" id={o.id} />
                <label style={{ flex: 1, minWidth: 240 }}>Message au client<input name="body" maxLength={2000} required /></label>
                <button type="submit"><Icon name="send" size={15} /> Envoyer</button>
              </form>
            ) : null}

            {['submitted', 'quoted'].includes(o.status) ? (
              <form action={rejectRequestAction} className="row" style={{ marginTop: 10 }}>
                <Keep base={base} sp={sp} tab="orders" id={o.id} />
                <label style={{ flex: 1, minWidth: 240 }}>Motif du refus (envoyé au client)<input name="reason" maxLength={500} required /></label>
                <ConfirmButton className="danger" message="Refuser cette demande ? Le client sera prévenu avec le motif.">Refuser la demande</ConfirmButton>
              </form>
            ) : null}
            {['submitted', 'quoted', 'accepted'].includes(o.status) ? (
              <form action={cancelRequestAction} className="row" style={{ marginTop: 10 }}>
                <Keep base={base} sp={sp} tab="orders" id={o.id} />
                <label style={{ flex: 1, minWidth: 240 }}>Motif de l’annulation (facultatif)<input name="reason" maxLength={300} /></label>
                <ConfirmButton className="secondary" message="Annuler cette demande non payée ?">Annuler la demande</ConfirmButton>
              </form>
            ) : null}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Le prix et les étapes de préparation sont gérés par les pâtissiers dans l’application. Une fois payée, la commande suit aussi le circuit normal des commandes du supermarché.
            </p>
          </div>
        );
      }
    }

    body = (
      <>
        {detail}
        <div className="tabs">
          {Object.entries(PASTRY_FILTERS).map(([k, v]) => (
            <a key={k} className={`btn ${k === f ? '' : 'secondary'}`} href={href(base, { tab: 'orders', f: k, store: sp.store })}>{v.label}{counts[k] ? ` (${counts[k]})` : ''}</a>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>N°</th><th>Reçue</th>{stores.length > 1 ? <th>Supermarché</th> : null}<th>Commande</th><th>Pour</th><th>Client</th><th>Pâtissier</th><th>Prix</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {(rows ?? []).map((o: any) => {
                const st = PASTRY_STATUS[o.status] ?? { label: o.status, cls: '' };
                const soon = o.desired_at && new Date(o.desired_at).getTime() - Date.now() < 6 * 3_600_000 && !['delivered', 'cancelled', 'rejected'].includes(o.status);
                return (
                  <tr key={o.id} style={o.id === sp.id ? { background: 'color-mix(in srgb, #E0457B 7%, transparent)' } : undefined}>
                    <td><b>{o.request_number}</b>{o.order_number ? <div className="muted" style={{ fontSize: 12 }}>{o.order_number}</div> : null}</td>
                    <td>{dateTime(o.created_at)}</td>
                    {stores.length > 1 ? <td>{storeName(o.store_id)}</td> : null}
                    <td><span className="mini">{CATEGORY[o.category] ?? o.category}</span> {o.cake_type}</td>
                    <td>{desired(o.desired_at)}{soon ? <> <span className="badge bad">Urgent</span></> : null}</td>
                    <td>{o.full_name}<div className="muted" style={{ fontSize: 12 }}>{o.phone}</div></td>
                    <td>{o.pastry_chefs?.display_name ?? <span className="muted">—</span>}</td>
                    <td>{o.quoted_price_usd != null ? usd(o.quoted_price_usd) : <span className="muted">—</span>}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td><Link className="btn secondary" href={href(base, { tab: 'orders', f, store: sp.store, id: o.id })}>Ouvrir</Link></td>
                  </tr>
                );
              })}
              {!rows?.length ? <tr><td colSpan={10} className="muted">Aucune commande pâtisserie dans cette catégorie.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------- Pâtissiers
  if (tab === 'chefs') {
    const cf = CHEF_FILTERS[sp.cf ?? ''] ? sp.cf! : (toCertify.length ? 'review' : 'all');
    const shown = chefs.filter((c) => {
      const isChef = c.profiles?.role === 'pastry_chef';
      if (cf === 'review') return isChef && c.status === 'active' && c.profile_completed_at && !c.certified;
      if (cf === 'certified') return isChef && c.certified;
      if (cf === 'active') return isChef && c.status === 'active';
      if (cf === 'suspended') return c.status === 'suspended' || !isChef;
      return true;
    });
    const docPaths = shown.map((c) => c.id_photo_path).filter(Boolean) as string[];
    const signed: Record<string, string> = {};
    if (docPaths.length) {
      const { data } = await sb.storage.from('pastry-documents').createSignedUrls(docPaths, 600);
      (data ?? []).forEach((s) => { if (s.path && s.signedUrl) signed[s.path] = s.signedUrl; });
    }
    body = (
      <>
        <form action={grantChefAction} className="card row" style={{ marginBottom: 16 }}>
          <input type="hidden" name="base" value={base} />
          <label style={{ flex: 1, minWidth: 240 }}>Donner l’accès pâtissier à un compte existant (e-mail)<input name="email" type="email" required placeholder="patissier@exemple.com" /></label>
          <label>Supermarché
            <select name="store_id" defaultValue={store?.id ?? stores[0]?.id} required>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button type="submit"><Icon name="chef" size={16} /> Ouvrir l’espace pâtissier</button>
        </form>
        <div className="tabs">
          {Object.entries(CHEF_FILTERS).map(([k, v]) => (
            <a key={k} className={`btn ${k === cf ? '' : 'secondary'}`} href={href(base, { tab: 'chefs', cf: k, store: sp.store })}>
              {v}{k === 'review' && toCertify.length ? ` (${toCertify.length})` : ''}
            </a>
          ))}
        </div>
        {!shown.length ? <p className="muted">Aucun pâtissier dans cette catégorie.</p> : null}
        {shown.map((c) => {
          const p = c.profiles ?? {};
          const comp = completion(c, p.phone);
          const isChef = p.role === 'pastry_chef';
          const age = ageOf(c.birth_date);
          return (
            <div key={c.id} className="card" style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="row" style={{ alignItems: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.avatar_url ? <img src={p.avatar_url} alt="" style={{ width: 64, height: 64, borderRadius: 32, objectFit: 'cover' }} />
                    : <div className="avatar" style={{ width: 64, height: 64, borderRadius: 32, display: 'grid', placeItems: 'center', background: '#3B2320', color: '#fff' }}><Icon name="chef" size={28} /></div>}
                  <div>
                    <b>{c.display_name || p.full_name}</b>{' '}
                    {c.certified ? <span className="certified-driver"><CertifiedDriver size={18} label="Pâtissier certifié" /> Pâtissier certifié</span> : null}{' '}
                    {!isChef ? <span className="badge bad">Accès retiré</span>
                      : c.status === 'suspended' ? <span className="badge bad">Suspendu</span>
                        : c.profile_completed_at ? (c.certified ? null : <span className="badge warn">Profil complet — à certifier</span>)
                          : <span className="badge">Profil {comp.done}/{comp.total}</span>}
                    <div className="muted">{p.email} · {p.phone ?? 'téléphone manquant'} · {storeName(c.store_id)}</div>
                  </div>
                </div>
                <span className="muted">Accès ouvert le {dateTime(c.created_at)}</span>
              </div>
              <div className="cols" style={{ marginTop: 12 }}>
                <div><div className="muted">Identité</div>{[GENDER[c.gender] ?? null, age != null ? `${age} ans` : null, c.nationality].filter(Boolean).join(' · ') || '—'}</div>
                <div><div className="muted">Pièce d’identité</div>{c.id_type ? `${ID_TYPE[c.id_type] ?? c.id_type} · ${c.id_number ?? ''}` : '—'}</div>
                <div><div className="muted">Adresse</div>{[c.address, c.commune].filter(Boolean).join(', ') || '—'}</div>
                <div><div className="muted">Contact d’urgence</div>{c.emergency_name ? `${c.emergency_name} · ${c.emergency_phone ?? ''}` : '—'}</div>
                <div><div className="muted">Spécialités</div>{(c.specialties ?? []).join(', ') || '—'}</div>
                <div><div className="muted">Expérience</div>{c.years_experience != null ? `${c.years_experience} an(s)` : '—'} · {c.orders_done} commande(s) livrée(s)</div>
              </div>
              {c.bio ? <p style={{ marginBottom: 0 }}>{c.bio}</p> : null}
              {!c.profile_completed_at && comp.missing.length ? <p className="muted" style={{ fontSize: 13 }}>À compléter dans l’application : {comp.missing.join(', ')}.</p> : null}
              <div className="row" style={{ marginTop: 12 }}>
                {c.id_photo_path && signed[c.id_photo_path]
                  ? <a href={signed[c.id_photo_path]} target="_blank" rel="noreferrer" className="btn secondary"><Icon name="file" size={15} /> Voir la pièce d’identité</a>
                  : <span className="badge bad">Pièce d’identité non envoyée</span>}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                {user.isSuper && isChef ? (
                  c.certified ? (
                    <form action={uncertifyChefAction}><Keep base={base} sp={sp} tab="chefs" /><input type="hidden" name="chef" value={c.id} />
                      <ConfirmButton className="secondary" message="Retirer la certification de ce pâtissier ?">Retirer la certification</ConfirmButton></form>
                  ) : (
                    <form action={certifyChefAction}><Keep base={base} sp={sp} tab="chefs" /><input type="hidden" name="chef" value={c.id} />
                      <button type="submit" disabled={!c.profile_completed_at} title={c.profile_completed_at ? '' : 'Profil incomplet'}>
                        <Icon name="shield" size={15} /> Certifier ce pâtissier</button></form>
                  )
                ) : null}
                {isChef && c.status === 'active' ? (
                  <form action={suspendChefAction}><Keep base={base} sp={sp} tab="chefs" /><input type="hidden" name="chef" value={c.id} />
                    <ConfirmButton className="secondary" message="Suspendre ce pâtissier ? Il ne recevra plus de commandes.">Suspendre</ConfirmButton></form>
                ) : null}
                {(c.status === 'suspended' || !isChef) ? (
                  <form action={activateChefAction}><Keep base={base} sp={sp} tab="chefs" /><input type="hidden" name="chef" value={c.id} />
                    <button type="submit" className="secondary">Réactiver</button></form>
                ) : null}
                {isChef ? (
                  <form action={revokeChefAction}><Keep base={base} sp={sp} tab="chefs" /><input type="hidden" name="chef" value={c.id} />
                    <ConfirmButton className="danger" message="Retirer l’accès pâtissier ? Le compte redeviendra un compte client.">Retirer l’accès</ConfirmButton></form>
                ) : null}
              </div>
            </div>
          );
        })}
        <p className="muted" style={{ fontSize: 13 }}>
          Seul l’administrateur général certifie un pâtissier, après vérification de son identité et de sa pièce. Les documents sont privés (liens valables 10 minutes). Toute décision est inscrite au journal d’audit.
        </p>
      </>
    );
  }

  // ---------------------------------------------------------------- Réglages
  if (tab === 'settings' && user.isSuper) {
    body = (
      <form action={saveSettingsAction} className="card stack" style={{ maxWidth: 560 }}>
        <input type="hidden" name="base" value={base} /><input type="hidden" name="tab" value="settings" />
        <div className="card-title"><span><Icon name="settings" /> Commandes pâtisserie</span></div>
        <label className="check"><input type="checkbox" name="enabled" defaultChecked={settings.enabled !== false} /> Commandes pâtisserie ouvertes aux clients</label>
        <label>Délai minimum entre la demande et l’heure souhaitée (heures, de 0 à 72)
          <input name="lead" type="number" min={0} max={72} step={1} defaultValue={Number(settings.min_lead_hours ?? 3)} />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Le client peut commander dès le jour même : avec 3 h, une demande faite à 10 h peut être souhaitée au plus tôt pour 13 h. La date et l’heure restent facultatives (« dès que possible »).
        </p>
        <button type="submit">Enregistrer</button>
      </form>
    );
  }

  return (
    <>
      <h1>Pâtisserie</h1>
      <p className="page-sub">Pâtissiers des supermarchés, certification et commandes pâtisserie des clients (gâteaux, pains, viennoiseries…).</p>
      <Flash ok={sp.ok} err={sp.err} />
      {stores.length > 1 ? (
        <form className="row" style={{ marginBottom: 12 }}>
          <input type="hidden" name="tab" value={tab} />
          <label>Supermarché
            <select name="store" defaultValue={store?.id ?? ''}>
              <option value="">Tous les supermarchés</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button type="submit" className="secondary">Afficher</button>
        </form>
      ) : null}
      <div className="grid" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.l} className="card kpi" style={{ '--kpi': k.c } as CSSProperties}>
            <div className="kpi-top"><div className="l">{k.l}</div><div className="kpi-ico"><Icon name={k.i} size={20} /></div></div>
            <div className="v">{k.v}</div>
            <div className="s">{k.s}</div>
          </div>
        ))}
      </div>
      <div className="tabs">
        {tabs.map((t) => <a key={t.key} className={`btn ${t.key === tab ? '' : 'secondary'}`} href={href(base, { tab: t.key, store: sp.store })}>{t.label}</a>)}
      </div>
      {!stores.length ? <div className="notice err">Aucun supermarché dans votre périmètre.</div> : body}
    </>
  );
}
