import { Shell } from '@/components/Shell';
import { requireRole } from '@/lib/auth';
import { managedStores } from '@/lib/store';

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('store_admin');
  const stores = await managedStores(user.id);
  return (
    <Shell
      user={user}
      links={[
        { href: '/magasin', label: 'Tableau de bord' },
        { href: '/magasin/commandes', label: 'Commandes' },
        { href: '/magasin/produits', label: 'Produits et stock' },
        { href: '/magasin/produits/nouveau', label: '+ Nouveau produit' },
        { href: '/magasin/messagerie', label: 'Messagerie' },
        { href: '/magasin/rapports', label: 'Rapports et exports' },
      ]}
    >
      {stores.length === 0 ? (
        <div className="notice err">Votre compte n&apos;est rattaché à aucun magasin. Demandez à l&apos;administrateur général de vous ajouter à votre supermarché.</div>
      ) : children}
    </Shell>
  );
}
