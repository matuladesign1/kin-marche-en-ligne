import Link from 'next/link';
import { dateTime, PAY_FR, STATUS_FR } from '@/lib/format';
import { newInternalThreadAction, replyAction, setTicketStatusAction } from '@/lib/messaging-actions';
import { supabaseServer } from '@/lib/supabase-server';

const TSTATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Ouverte', cls: 'warn' }, pending: { label: 'En attente', cls: '' },
  resolved: { label: 'Résolue', cls: 'ok' }, closed: { label: 'Fermée', cls: '' },
};
const CHANNEL: Record<string, string> = { general: 'Assistance Kin Marché', store: 'Supermarché', driver: 'Livreur' };

export interface MessagingProps {
  base: string;                    // /admin/messagerie ou /magasin/messagerie
  userId: string;
  ticketId?: string;
  filter: 'all' | 'customers' | 'internal';
  storeId?: string | null;          // espace magasin : magasin courant
  stores: { id: string; name: string }[]; // magasins proposés pour un nouveau fil interne
  err?: string;
}

export async function Messaging({ base, userId, ticketId, filter, storeId, stores, err }: MessagingProps) {
  const sb = await supabaseServer();
  let q = sb.from('support_tickets')
    .select('id, subject, status, channel, is_internal, updated_at, store_id, stores(name), orders(order_number), profiles!support_tickets_customer_id_fkey(full_name, email)')
    .order('updated_at', { ascending: false }).limit(150);
  if (storeId) q = q.eq('store_id', storeId);
  if (filter === 'internal') q = q.eq('is_internal', true);
  if (filter === 'customers') q = q.eq('is_internal', false);
  const { data: tickets } = await q;

  const current = ticketId ? (tickets ?? []).find((t: any) => t.id === ticketId) ?? null : null;
  let messages: any[] = [];
  let order: any = null;
  if (ticketId) {
    const { data } = await sb.from('messages').select('id, sender_id, body, attachment_path, read_at, created_at')
      .eq('ticket_id', ticketId).order('created_at');
    messages = data ?? [];
    // Noms des participants (selon ce que la RLS autorise à lire).
    const ids = [...new Set(messages.map((m) => m.sender_id))];
    const { data: people } = ids.length ? await sb.from('profiles').select('id, full_name, role').in('id', ids) : { data: [] };
    const names = new Map((people ?? []).map((p: any) => [p.id, p.full_name ?? (p.role === 'super_admin' ? 'Direction' : '')]));
    messages.forEach((m) => { m.author = m.sender_id === userId ? 'Moi' : names.get(m.sender_id) || 'Participant'; });
    const paths = messages.map((m) => m.attachment_path).filter(Boolean);
    if (paths.length) {
      const { data: urls } = await sb.storage.from('chat-attachments').createSignedUrls(paths, 900);
      const map = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
      messages.forEach((m) => { m.url = m.attachment_path ? map.get(m.attachment_path) : null; });
    }
    const unread = messages.filter((m) => m.sender_id !== userId && !m.read_at).map((m) => m.id);
    if (unread.length) await sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', unread);
    const { data: tk } = await sb.from('support_tickets').select('orders(id, order_number, status, payment_status, total_usd)').eq('id', ticketId).maybeSingle();
    order = (tk as any)?.orders ?? null;
  }
  const storeQ = storeId ? `&store=${storeId}` : '';

  return (
    <>
      {err ? <div className="notice err">{err}</div> : null}
      <div className="row" style={{ marginBottom: 12 }}>
        {(['all', 'customers', 'internal'] as const).map((f) => (
          <a key={f} className={`btn ${f === filter ? '' : 'secondary'}`} href={`${base}?f=${f}${storeQ}`}>
            {f === 'all' ? 'Toutes' : f === 'customers' ? 'Clients' : 'Interne (magasins ↔ Direction)'}
          </a>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 0, maxHeight: '75vh', overflowY: 'auto' }}>
          {!tickets?.length ? <p className="muted" style={{ padding: 16 }}>Aucune conversation.</p> : null}
          {(tickets ?? []).map((t: any) => (
            <Link key={t.id} href={`${base}?f=${filter}&t=${t.id}${storeQ}`}
              style={{ display: 'block', padding: 12, borderBottom: '1px solid var(--border)', background: t.id === ticketId ? 'var(--surface-alt)' : undefined, color: 'inherit', textDecoration: 'none' }}>
              <div><b>{t.subject}</b></div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t.is_internal ? 'Interne' : CHANNEL[t.channel]} · {t.stores?.name ?? '—'}{t.orders ? ` · ${t.orders.order_number}` : ''}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t.profiles?.full_name ?? t.profiles?.email} · {dateTime(t.updated_at)} <span className={`badge ${TSTATUS[t.status]?.cls}`}>{TSTATUS[t.status]?.label}</span>
              </div>
            </Link>
          ))}
        </div>

        <div>
          {current ? (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>{(current as any).subject}</h2>
                <form action={setTicketStatusAction} className="row">
                  <input type="hidden" name="base" value={base} />
                  <input type="hidden" name="ticket" value={current.id} />
                  <input type="hidden" name="store" value={storeId ?? ''} />
                  <select name="status" defaultValue={(current as any).status}>
                    {Object.entries(TSTATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <button className="secondary">Mettre à jour</button>
                </form>
              </div>
              {order ? (
                <div className="notice">
                  Commande <b>{order.order_number}</b> — {STATUS_FR[order.status] ?? order.status} · {PAY_FR[order.payment_status] ?? order.payment_status}
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0', maxHeight: '55vh', overflowY: 'auto' }}>
                {messages.map((m) => {
                  const mine = m.sender_id === userId;
                  return (
                    <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', background: mine ? 'var(--primary)' : 'var(--surface-alt)', color: mine ? '#fff' : 'inherit', padding: 10, borderRadius: 12 }}>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>{m.author} · {dateTime(m.created_at)}</div>
                      {m.url ? (m.attachment_path.endsWith('.pdf')
                        ? <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>📄 Ouvrir le PDF</a>
                        // eslint-disable-next-line @next/next/no-img-element
                        : <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt="Pièce jointe" style={{ maxWidth: 260, borderRadius: 8, display: 'block' }} /></a>) : null}
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    </div>
                  );
                })}
              </div>
              <form action={replyAction} className="row">
                <input type="hidden" name="base" value={base} />
                <input type="hidden" name="ticket" value={current.id} />
                <input type="hidden" name="store" value={storeId ?? ''} />
                <textarea name="body" rows={3} maxLength={4000} placeholder="Votre réponse" style={{ flex: 1, minWidth: 240 }} />
                <input type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf" />
                <button>Envoyer</button>
              </form>
            </div>
          ) : (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Nouveau fil interne</h2>
              <p className="muted">Échange entre le directeur ou les assistants d&apos;un supermarché et la Direction de l&apos;application.</p>
              <form action={newInternalThreadAction} style={{ display: 'grid', gap: 8 }}>
                <input type="hidden" name="base" value={base} />
                <label>Supermarché
                  <select name="store_id" defaultValue={storeId ?? stores[0]?.id}>
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>Sujet <input name="subject" maxLength={140} required /></label>
                <label>Message <textarea name="body" rows={4} maxLength={4000} required /></label>
                <button>Créer le fil</button>
              </form>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
