import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChatEnhancer } from './ChatEnhancer';
import { Icon, Verified } from './icons';
import { PAY_FR, STATUS_FR, usd } from '@/lib/format';
import { newInternalThreadAction, replyAction, setTicketStatusAction } from '@/lib/messaging-actions';
import { supabaseServer } from '@/lib/supabase-server';

const TSTATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Ouverte', cls: 'warn' }, pending: { label: 'En attente', cls: 'info' },
  resolved: { label: 'Résolue', cls: 'ok' }, closed: { label: 'Fermée', cls: '' },
};

export type InboxFilter = 'all' | 'unread' | 'open' | 'customers' | 'internal';
const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' }, { key: 'unread', label: 'Non lues' }, { key: 'open', label: 'Ouvertes' },
  { key: 'customers', label: 'Clients' }, { key: 'internal', label: 'Interne' },
];
export function parseFilter(v?: string): InboxFilter {
  return FILTERS.some((f) => f.key === v) ? (v as InboxFilter) : 'all';
}

// ---------- Dates (heure de Kinshasa) ----------
const TZ = 'Africa/Kinshasa';
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (d: string | number) => DAY.format(new Date(d));
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
function rel(iso: string): 'today' | 'yesterday' | null {
  const k = dayKey(iso);
  if (k === dayKey(Date.now())) return 'today';
  if (k === dayKey(Date.now() - 86_400_000)) return 'yesterday';
  return null;
}
function dayLabel(iso: string) {
  const r = rel(iso);
  if (r === 'today') return 'Aujourd’hui';
  if (r === 'yesterday') return 'Hier';
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function listTime(iso: string) {
  const r = rel(iso);
  if (r === 'today') return hhmm(iso);
  if (r === 'yesterday') return 'Hier';
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ---------- Avatars ----------
const PALETTE = ['#DE3530', '#0097FC', '#01789D', '#7B4BC4', '#13A35F', '#E8A317', '#D9467A', '#2F6FDE'];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

interface Ticket {
  id: string; subject: string; status: string; channel: string; is_internal: boolean; updated_at: string;
  store_id: string | null; customer_id: string; order_id: string | null;
  province: string | null; city: string | null; commune: string | null;
  stores: { name: string } | null; orders: { order_number: string } | null;
}
interface Msg {
  id?: string; ticket_id: string; sender_id: string; body: string; sender_label: string | null; sender_verified?: boolean;
  attachment_path: string | null; read_at: string | null; created_at: string; url?: string | null;
}

const PLACEHOLDER_BODIES = new Set(['Pièce jointe', '📎 Pièce jointe']);
const TICKET_SELECT = 'id, subject, status, channel, is_internal, updated_at, store_id, customer_id, order_id, province, city, commune, stores(name), orders(order_number)';

export interface MessagingProps {
  base: string;                      // /admin/messagerie ou /magasin/messagerie
  userId: string;
  viewer: 'direction' | 'store';     // côté de la personne connectée dans les fils internes
  ticketId?: string;
  filter: InboxFilter;
  q?: string;
  showNew?: boolean;
  storeId?: string | null;           // espace magasin : magasin courant
  stores: { id: string; name: string }[]; // magasins proposés pour un nouveau fil interne
  err?: string;
}

export async function Messaging({ base, userId, viewer, ticketId, filter, q = '', showNew, storeId, stores, err }: MessagingProps) {
  const sb = await supabaseServer();

  let query = sb.from('support_tickets').select(TICKET_SELECT).order('updated_at', { ascending: false }).limit(200);
  if (storeId) query = query.eq('store_id', storeId);
  if (filter === 'internal') query = query.eq('is_internal', true);
  if (filter === 'customers') query = query.eq('is_internal', false);
  if (filter === 'open') query = query.in('status', ['open', 'pending']);
  const { data: rows } = await query;
  const fetched = (rows ?? []) as unknown as Ticket[];

  let current: Ticket | null = ticketId ? fetched.find((t) => t.id === ticketId) ?? null : null;
  if (ticketId && !current) {
    const { data } = await sb.from('support_tickets').select(TICKET_SELECT).eq('id', ticketId).maybeSingle();
    current = (data as unknown as Ticket) ?? null;
  }
  const byId = new Map(fetched.map((t) => [t.id, t]));
  if (current) byId.set(current.id, current);

  // « De mon côté » : l'équipe Kin Marché dans un fil client ; mon camp (Direction ou magasin) dans un fil interne.
  const mine = (m: Pick<Msg, 'sender_id' | 'sender_label'>, t: Ticket) => {
    if (!t.is_internal) return m.sender_id !== t.customer_id;
    if (m.sender_id === userId) return true;
    if (!m.sender_label) return false;
    const direction = m.sender_label === 'DIRECTION Kin Marché';
    return viewer === 'direction' ? direction : !direction;
  };

  // Derniers messages (aperçu + non lus) — la RLS limite aux fils visibles.
  const { data: recentRows } = await sb.from('messages')
    .select('ticket_id, sender_id, body, sender_label, attachment_path, read_at, created_at')
    .order('created_at', { ascending: false }).limit(800);
  const last = new Map<string, Msg>();
  const unread = new Map<string, number>();
  for (const m of (recentRows ?? []) as Msg[]) {
    const t = byId.get(m.ticket_id);
    if (!t) continue;
    if (!last.has(m.ticket_id)) last.set(m.ticket_id, m);
    if (!m.read_at && !mine(m, t)) unread.set(m.ticket_id, (unread.get(m.ticket_id) ?? 0) + 1);
  }

  // Noms des participants (sans téléphone, e-mail ni adresse).
  const ids = [...byId.keys()].slice(0, 300);
  const { data: people } = ids.length ? await sb.rpc('ticket_people', { p_ticket_ids: ids }) : { data: [] };
  const customerName = new Map<string, string>();
  const personName = new Map<string, string>();
  for (const p of (people ?? []) as { ticket_id: string; user_id: string; full_name: string | null; is_customer: boolean }[]) {
    if (!p.full_name) continue;
    personName.set(p.user_id, p.full_name);
    if (p.is_customer) customerName.set(p.ticket_id, p.full_name);
  }

  const titleOf = (t: Ticket) => (t.is_internal ? t.stores?.name ?? 'Supermarché' : customerName.get(t.id) ?? 'Client Kin Marché');
  const asLabel = (t: Ticket) => (t.is_internal
    ? (viewer === 'direction' ? 'DIRECTION Kin Marché' : `SUPERMARCHÉ ${t.stores?.name ?? ''}`.trim())
    : t.channel === 'store' ? `ASSISTANT ${t.stores?.name ?? 'supermarché'}`
      : t.channel === 'driver' ? 'LIVREUR Kin Marché'
        : `ASSISTANT ${t.city ?? t.province ?? 'Kin Marché'}`);
  const channelShort = (t: Ticket) => (t.is_internal ? 'Interne' : t.channel === 'store' ? 'Supermarché' : t.channel === 'driver' ? 'Livreur' : `Assistance ${t.city ?? t.province ?? ''}`.trim());
  const region = (t: Ticket) => [...new Set([t.commune, t.city, t.province].filter(Boolean))].join(', ');

  const totalUnread = [...unread.values()].reduce((a, b) => a + b, 0);
  const term = q.trim().toLowerCase();
  let list = fetched;
  if (term) {
    list = list.filter((t) => [t.subject, titleOf(t), t.stores?.name, t.orders?.order_number, t.city, t.province, t.commune]
      .some((v) => v?.toLowerCase().includes(term)));
  }
  if (filter === 'unread') list = list.filter((t) => (unread.get(t.id) ?? 0) > 0);

  // Discussion ouverte : messages, pièces jointes, lecture, commande liée.
  let messages: Msg[] = [];
  let order: { order_number: string; status: string; payment_status: string; total_usd: number } | null = null;
  if (current) {
    const { data } = await sb.from('messages')
      .select('id, ticket_id, sender_id, body, sender_label, sender_verified, attachment_path, read_at, created_at')
      .eq('ticket_id', current.id).order('created_at', { ascending: false }).limit(500);
    messages = ((data ?? []) as Msg[]).reverse();
    const paths = messages.map((m) => m.attachment_path).filter((p): p is string => !!p);
    if (paths.length) {
      const { data: urls } = await sb.storage.from('chat-attachments').createSignedUrls(paths, 900);
      const map = new Map<string, string>();
      for (const u of urls ?? []) if (u.path && u.signedUrl) map.set(u.path, u.signedUrl);
      messages.forEach((m) => { m.url = m.attachment_path ? map.get(m.attachment_path) ?? null : null; });
    }
    const t = current;
    const toRead = messages.filter((m) => !m.read_at && !mine(m, t)).map((m) => m.id!);
    if (toRead.length) {
      await sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', toRead);
      unread.delete(t.id);
    }
    if (t.order_id) {
      const { data: o } = await sb.from('orders').select('order_number, status, payment_status, total_usd').eq('id', t.order_id).maybeSingle();
      order = o;
    }
  }

  const link = (p: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { f: filter === 'all' ? null : filter, q: q || null, store: storeId ?? null, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `${base}?${s}` : base;
  };

  const avatar = (t: Ticket, size?: number) => (
    <div className="chat-av" style={{ background: t.is_internal ? 'var(--side)' : colorFor(t.customer_id), width: size, height: size }}>
      {t.is_internal ? <Icon name="store" size={20} /> : initials(titleOf(t))}
    </div>
  );

  // Bulles groupées par jour, comme une messagerie instantanée.
  const bubbles: ReactNode[] = [];
  if (current) {
    let prevDay = '';
    let prevSender = '';
    for (const m of messages) {
      const dk = dayKey(m.created_at);
      if (dk !== prevDay) {
        bubbles.push(<div key={`d-${dk}`} className="day-chip">{dayLabel(m.created_at)}</div>);
        prevDay = dk;
        prevSender = '';
      }
      const me = mine(m, current);
      const first = m.sender_id !== prevSender;
      prevSender = m.sender_id;
      const who = m.sender_id === userId ? 'vous' : personName.get(m.sender_id) ?? '';
      const isPdf = !!m.attachment_path?.toLowerCase().endsWith('.pdf');
      bubbles.push(
        <div key={m.id} className={`bubble ${me ? 'me' : 'them'}${first ? ' first' : ''}`}>
          {first && m.sender_label ? (
            <div className="who">
              {m.sender_label}{m.sender_verified ? <Verified size={13} /> : null}
              {who ? <small>· {who}</small> : null}
            </div>
          ) : null}
          {m.url ? (isPdf ? (
            <a className="file-chip" href={m.url} target="_blank" rel="noreferrer">
              <Icon name="file" size={22} /><span>Document PDF</span><Icon name="external" size={14} />
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt="Photo envoyée dans la discussion" /></a>
          )) : null}
          {m.url && PLACEHOLDER_BODIES.has(m.body) ? null : <div className="txt">{m.body}</div>}
          <div className="time">
            {hhmm(m.created_at)}
            {me ? <Icon name={m.read_at ? 'checks' : 'check'} size={15} className={`tick${m.read_at ? ' read' : ''}`} /> : null}
          </div>
        </div>,
      );
    }
  }

  const paneOpen = !!current || !!showNew;
  const poll = `/api/inbox${storeId ? `?store=${storeId}` : ''}`;

  return (
    <>
      {err ? <div className="notice err">{err}</div> : null}
      {ticketId && !current ? <div className="notice err">Discussion introuvable ou non autorisée pour votre compte.</div> : null}
      <div className={`chat${paneOpen ? ' has-pane' : ''}`}>
        <aside className="chat-list" aria-label="Discussions">
          <div className="chat-list-head">
            <div className="chat-list-title">
              <span>Discussions <span className="muted">({byId.size})</span></span>
              {stores.length ? (
                <Link className="icon-btn" href={link({ new: '1' })} title="Nouveau fil interne avec un supermarché" aria-label="Nouveau fil interne">
                  <Icon name="plus" size={18} />
                </Link>
              ) : null}
            </div>
            <form action={base} className="chat-search" role="search">
              <Icon name="search" size={16} />
              <input name="q" defaultValue={q} placeholder="Client, commande, magasin, ville…" aria-label="Rechercher une discussion" />
              {filter !== 'all' ? <input type="hidden" name="f" value={filter} /> : null}
              {storeId ? <input type="hidden" name="store" value={storeId} /> : null}
            </form>
            <nav className="chat-filters" aria-label="Filtres">
              {FILTERS.map((f) => (
                <Link key={f.key} className={`chip${f.key === filter ? ' active' : ''}`}
                  href={link({ f: f.key === 'all' ? null : f.key, t: null })}>
                  {f.label}{f.key === 'unread' && totalUnread ? <span>{totalUnread}</span> : null}
                </Link>
              ))}
            </nav>
          </div>
          <div className="chat-items">
            {!list.length ? <p className="muted" style={{ padding: 16, textAlign: 'center' }}>Aucune discussion{term ? ' pour cette recherche' : ''}.</p> : null}
            {list.map((t) => {
              const lm = last.get(t.id);
              const n = unread.get(t.id) ?? 0;
              return (
                <Link key={t.id} href={link({ t: t.id })} className={`chat-item${t.id === current?.id ? ' active' : ''}`}>
                  {avatar(t)}
                  <div className="chat-meta">
                    <div className="t">
                      <b>{titleOf(t)}</b>
                      <span className={`time${n ? ' unread' : ''}`}>{listTime(lm?.created_at ?? t.updated_at)}</span>
                    </div>
                    <div className="p">
                      {lm && mine(lm, t) ? <Icon name={lm.read_at ? 'checks' : 'check'} size={14} className={`tick${lm.read_at ? ' read' : ''}`} /> : null}
                      {lm?.attachment_path ? <Icon name="clip" size={13} /> : null}
                      <span className="txt">{lm ? (lm.attachment_path && PLACEHOLDER_BODIES.has(lm.body) ? 'Pièce jointe' : lm.body) : t.subject}</span>
                      {n ? <span className="chat-unread">{n}</span> : null}
                    </div>
                    <div className="tags">
                      <span className="mini">{channelShort(t)}</span>
                      {t.orders?.order_number ? <span className="mini">{t.orders.order_number}</span> : null}
                      <span className={`mini ${TSTATUS[t.status]?.cls ?? ''}`}>{TSTATUS[t.status]?.label ?? t.status}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </aside>

        {current ? (
          <section className="chat-pane" aria-label={`Discussion avec ${titleOf(current)}`}>
            <header className="chat-head">
              <Link href={link({})} className="chat-back" aria-label="Retour aux discussions"><Icon name="back" size={20} /></Link>
              {avatar(current, 42)}
              <div className="chat-head-meta">
                <b>{titleOf(current)}</b>
                <div className="muted">
                  {current.is_internal ? 'Fil interne Direction ↔ supermarché' : `Vous répondez en tant que ${asLabel(current)}`}
                  {region(current) ? ` · ${region(current)}` : ''} · {current.subject}
                </div>
              </div>
              <form action={setTicketStatusAction} className="chat-status">
                <input type="hidden" name="base" value={base} />
                <input type="hidden" name="ticket" value={current.id} />
                <input type="hidden" name="store" value={storeId ?? ''} />
                <input type="hidden" name="f" value={filter === 'all' ? '' : filter} />
                <input type="hidden" name="q" value={q} />
                <select name="status" defaultValue={current.status} aria-label="Statut de la discussion">
                  {Object.entries(TSTATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <button className="secondary" title="Mettre à jour le statut" aria-label="Mettre à jour le statut"><Icon name="check" size={16} /></button>
              </form>
            </header>
            {order ? (
              <div className="chat-pin">
                <Icon name="orders" size={16} />
                <span>Commande <b>{order.order_number}</b></span>
                <span className="badge">{STATUS_FR[order.status] ?? order.status}</span>
                <span className={`badge ${order.payment_status === 'succeeded' ? 'ok' : 'warn'}`}>{PAY_FR[order.payment_status] ?? order.payment_status}</span>
                <span className="muted">{usd(order.total_usd)}</span>
              </div>
            ) : null}
            <div className="chat-body" id="chat-body">
              <div className="chat-banner">
                <Icon name="lock" size={13} /> Conversation réservée à ses participants. Un assistant Kin Marché ne demande jamais de code PIN Mobile Money ni de code de livraison.
              </div>
              {bubbles}
              {!messages.length ? <div className="day-chip">Aucun message pour le moment</div> : null}
            </div>
            <form action={replyAction} className="chat-compose">
              <input type="hidden" name="base" value={base} />
              <input type="hidden" name="ticket" value={current.id} />
              <input type="hidden" name="store" value={storeId ?? ''} />
              <input type="hidden" name="f" value={filter === 'all' ? '' : filter} />
              <input type="hidden" name="q" value={q} />
              <label className="file" title="Joindre une image ou un PDF">
                <Icon name="clip" size={20} />
                <input type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf" aria-label="Joindre une image ou un PDF" />
              </label>
              <textarea id="chat-input" name="body" rows={1} maxLength={4000} placeholder={`Écrire en tant que ${asLabel(current)}…`} aria-label="Votre message" />
              <button type="submit" aria-label="Envoyer"><Icon name="send" size={18} /></button>
            </form>
            <ChatEnhancer count={messages.length} poll={poll} />
          </section>
        ) : showNew && stores.length ? (
          <section className="chat-pane" aria-label="Nouveau fil interne">
            <header className="chat-head">
              <Link href={link({ new: null })} className="chat-back" aria-label="Retour aux discussions"><Icon name="back" size={20} /></Link>
              <div className="chat-av" style={{ background: 'var(--primary)' }}><Icon name="plus" size={20} /></div>
              <div className="chat-head-meta">
                <b>Nouveau fil interne</b>
                <div className="muted">Direction Kin Marché ↔ directeur et assistants d’un supermarché</div>
              </div>
            </header>
            <div className="chat-body">
              <form action={newInternalThreadAction} className="card stack new-thread">
                <input type="hidden" name="base" value={base} />
                <label>Supermarché
                  <select name="store_id" defaultValue={storeId ?? stores[0]?.id}>
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>Sujet <input name="subject" maxLength={140} required placeholder="Ex. : réassort, horaires, commande KM-…" /></label>
                <label>Message <textarea name="body" rows={5} maxLength={4000} required /></label>
                <button type="submit"><Icon name="send" size={16} /> Démarrer la discussion</button>
              </form>
            </div>
          </section>
        ) : (
          <section className="chat-pane chat-welcome">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-square.png" alt="" width={92} height={92} />
            <h2>Messagerie Kin Marché</h2>
            <p>
              Répondez aux clients sous un nom certifié <b>« ASSISTANT (ville) »</b> <Verified size={14} /> et échangez avec les supermarchés.
              Choisissez une discussion dans la liste.
            </p>
            {stores.length ? <Link className="btn" href={link({ new: '1' })}><Icon name="plus" size={16} /> Nouveau fil interne</Link> : null}
            <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="lock" size={13} /> Accès réservé aux participants de chaque discussion.</div>
            <ChatEnhancer count={0} poll={poll} everyMs={15000} />
          </section>
        )}
      </div>
    </>
  );
}
