import { Shell } from '@/components/Shell';
import { requireRole } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('super_admin');
  return (
    <Shell
      user={user}
      links={[
        { href: '/admin', label: 'Tableau de bord' },
        { href: '/admin/magasins', label: 'Supermarchés' },
        { href: '/admin/livreurs', label: 'Livreurs' },
        { href: '/admin/utilisateurs', label: 'Utilisateurs et rôles' },
        { href: '/admin/taux', label: 'Taux de change' },
        { href: '/admin/parametres', label: 'Logo et couleurs' },
      ]}
    >
      {children}
    </Shell>
  );
}
