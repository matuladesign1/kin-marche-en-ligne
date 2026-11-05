import Link from 'next/link';
import { Icon } from '@/components/icons';
import { requireStaff, type Permission } from '@/lib/auth';
import { dateTime, PAY_FR, STATUS_FR, usd } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const ROLES: Record<string, string> = {
  customer: 'Client', driver: 'Livreur', store_admin: 'Directeur / gestionnaire', agent: 'Agent', super_admin: 'Administrateur général',
};
const TICKET: Record<string, string> = { open: 'Ouverte', pending: 'En attente', resolved: 'Résolue', closed: 'Fermée' };

/** Recherche globale de la barre latérale (selon les missions de la personne connectée, la RLS filtre aussi). */
export default async function Recherche({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff();
  const can = (p: Permission) => user.permissions.includes(p);
  const q = (sp.q ?? '').trim();
  // Caractères réservés de la syntaxe des filtres retirés (aucune injection de filtre possible).
  const term = q.replace(/[%,()*"'\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const like = `%${term}%`;
  const sb = await supabaseServer();

  const [orders, stores, people, tickets, products] = await Promise.all([
    term && (can('finance') || can('support'))
      ? sb.from('orders').select('id, order_number, status, payment_status, total_usd, created_at, stores(name)').ilike('order_number', like).order('created_at', { ascending: false }).limit(10)
      : null,
    term && (can('stores') || user.isSuper)
      ? sb.from('stores').select('id, name, commune, city, is_active, address_verified').or(`name.ilike.${like},commune.ilike.${like},code.ilike.${like}`).order('name').limit(10)
      : null,
    term && can('users')
      ? sb.from('profiles').select('id, full_name, email, role, is_active').or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(10)
      : null,
    term && can('support')
      ? sb.from('support_tickets').select('id, subject, status, updated_at, city').ilike('subject', like).order('updated_at', { ascending: false }).limit(10)
      : null,
    term && user.isSuper
      ? sb.from('products').select('id, name, brand, sku, barcode, is_active').or(`name.ilike.${like},sku.ilike.${like},barcode.ilike.${like},brand.ilike.${like}`).order('name').limit(10)
      : null,
  ]);
  const total = [orders, stores, people, tickets, products].reduce((n, r) => n + (r?.data?.length ?? 0), 0);

  return (
    <>
      <h1>Recherche</h1>
      <form action="/admin/recherche" className="card row" style={{ marginBottom: 16 }} role="search">
        <label style={{ flex: 1, minWidth: 240 }}>Commande, supermarché, client, discussion, produit
          <input name="q" defaultValue={q} autoFocus placeholder="Ex. : KM-2026…, Limete, Marie…" />
        </label>
        <button type="submit"><Icon name="search" size={16} /> Rechercher</button>
      </form>
      {!term ? <p className="muted">Saisissez au moins un mot.</p> : <p className="page-sub">{total} résultat(s) pour « {term} ».</p>}

      <div className="dash">
        {orders?.data?.length ? (
          <div className="card span-12">
            <div className="card-title"><span><Icon name="orders" size={16} /> Commandes</span></div>
            <div className="table-wrap"><table className="flat">
              <thead><tr><th>N°</th><th>Magasin</th><th>Statut</th><th>Paiement</th><th>Total</th><th>Date</th></tr></thead>
              <tbody>{orders.data.map((o: any) => (
                <tr key={o.id}><td><b>{o.order_number}</b></td><td>{o.stores?.name ?? '—'}</td><td>{STATUS_FR[o.status] ?? o.status}</td>
                  <td>{PAY_FR[o.payment_status] ?? o.payment_status}</td><td>{usd(o.total_usd)}</td><td className="muted">{dateTime(o.created_at)}</td></tr>
              ))}</tbody>
            </table></div>
          </div>
        ) : null}
        {stores?.data?.length ? (
          <div className="card span-6">
            <div className="card-title"><span><Icon name="store" size={16} /> Supermarchés</span></div>
            <div className="alerts">{stores.data.map((s: any) => (
              <Link key={s.id} className="alert-item" href={`/admin/magasins/${s.id}`}>
                <Icon name="store" /><span><b>{s.name}</b><br /><span className="muted">{[s.commune, s.city].filter(Boolean).join(', ')}{s.address_verified ? '' : ' · adresse à vérifier'}</span></span>
                <span className="n">{s.is_active ? <span className="badge ok">actif</span> : <span className="badge">inactif</span>}</span>
              </Link>
            ))}</div>
          </div>
        ) : null}
        {people?.data?.length ? (
          <div className="card span-6">
            <div className="card-title"><span><Icon name="users" size={16} /> Comptes</span></div>
            <div className="alerts">{people.data.map((p: any) => (
              <Link key={p.id} className="alert-item" href={`/admin/utilisateurs?q=${encodeURIComponent(p.email ?? p.full_name ?? '')}`}>
                <Icon name="users" /><span><b>{p.full_name ?? p.email}</b><br /><span className="muted">{p.email} · {ROLES[p.role] ?? p.role}</span></span>
                <span className="n">{p.is_active ? null : <span className="badge bad">désactivé</span>}</span>
              </Link>
            ))}</div>
          </div>
        ) : null}
        {tickets?.data?.length ? (
          <div className="card span-6">
            <div className="card-title"><span><Icon name="chat" size={16} /> Discussions</span></div>
            <div className="alerts">{tickets.data.map((t: any) => (
              <Link key={t.id} className="alert-item" href={`/admin/messagerie?t=${t.id}`}>
                <Icon name="chat" /><span><b>{t.subject}</b><br /><span className="muted">{t.city ?? ''} · {dateTime(t.updated_at)}</span></span>
                <span className="n"><span className="badge">{TICKET[t.status] ?? t.status}</span></span>
              </Link>
            ))}</div>
          </div>
        ) : null}
        {products?.data?.length ? (
          <div className="card span-6">
            <div className="card-title"><span><Icon name="box" size={16} /> Produits du catalogue</span></div>
            <div className="alerts">{products.data.map((p: any) => (
              <div key={p.id} className="alert-item">
                <Icon name="box" /><span><b>{p.name}</b><br /><span className="muted">{[p.brand, p.sku, p.barcode].filter(Boolean).join(' · ')}</span></span>
                <span className="n">{p.is_active ? <span className="badge ok">actif</span> : <span className="badge">inactif</span>}</span>
              </div>
            ))}</div>
          </div>
        ) : null}
      </div>
      {term && !total ? <div className="notice">Aucun résultat dans les données auxquelles vous avez accès.</div> : null}
    </>
  );
}
