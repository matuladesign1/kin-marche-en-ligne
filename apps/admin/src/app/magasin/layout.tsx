import type { NavGroup } from '@/components/NavLinks';
import { Shell } from '@/components/Shell';
import { requireRole } from '@/lib/auth';
import { managedStores } from '@/lib/store';
import { supabaseServer } from '@/lib/supabase-server';

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('store_admin');
  const stores = await managedStores(user.id);
  // Demandes pâtisserie en attente d'un prix (0 tant que la migration n'est pas appliquée).
  const sb = await supabaseServer();
  const pastryNew = stores.length
    ? (await sb.from('cake_orders').select('id', { count: 'exact', head: true }).in('store_id', stores.map((s) => s.id)).eq('status', 'submitted')).count ?? 0
    : 0;
  const groups: NavGroup[] = [
    { title: 'Pilotage', links: [
      { href: '/magasin', label: 'Tableau de bord', icon: 'dashboard' },
      { href: '/magasin/rapports', label: 'Rapports et exports', icon: 'chart' },
    ] },
    { title: 'Magasin', links: [
      { href: '/magasin/commandes', label: 'Commandes', icon: 'orders' },
      { href: '/magasin/produits', label: 'Produits et stock', icon: 'box' },
      { href: '/magasin/produits/nouveau', label: 'Nouveau produit', icon: 'plus' },
      { href: '/magasin/patisserie', label: 'Pâtisserie', icon: 'cake', badge: pastryNew },
      { href: '/magasin/messagerie', label: 'Messagerie', icon: 'chat' },
    ] },
    { title: 'Clients', links: [
      { href: '/magasin/fidelite', label: 'Cartes fidélité', icon: 'card' },
    ] },
  ];
  return (
    <Shell user={user} groups={groups} roleLabel={stores[0]?.title ? `${stores[0].title} de supermarché` : 'Supermarché'} subtitle={stores.map((s) => s.name).join(' · ')}>
      {stores.length === 0 ? (
        <div className="notice err">Votre compte n&apos;est rattaché à aucun magasin. Demandez à l&apos;administrateur général de vous ajouter à votre supermarché.</div>
      ) : children}
    </Shell>
  );
}
