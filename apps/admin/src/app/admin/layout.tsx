import type { NavGroup } from '@/components/NavLinks';
import { Shell } from '@/components/Shell';
import { PERMISSION_LABELS, requireStaff, scopeLabel } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase-server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const can = (p: keyof typeof PERMISSION_LABELS) => user.permissions.includes(p);
  const sb = await supabaseServer();
  const count = async (table: string, f: (q: any) => any) => (await f(sb.from(table).select('*', { count: 'exact', head: true }))).count ?? 0;
  const [pendingDrivers, pendingProofs, openTickets, loyaltyToVerify, giftsToHand] = await Promise.all([
    can('drivers') ? count('drivers', (q) => q.eq('status', 'pending_review')) : 0,
    can('finance') ? count('payment_proofs', (q) => q.eq('status', 'pending')) : 0,
    can('support') ? count('support_tickets', (q) => q.eq('status', 'open')) : 0,
    // Cartes en magasin reliées automatiquement, en attente de vérification.
    user.isSuper ? count('loyalty_accounts', (q) => q.not('external_member_id', 'is', null).is('link_verified_at', null)) : 0,
    // Cadeaux de la Roue de la chance gagnés et pas encore remis (0 tant que la migration n'est pas appliquée).
    user.isSuper ? count('wheel_rewards', (q) => q.eq('kind', 'product').in('status', ['pending', 'attached'])) : 0,
  ]);

  const groups: NavGroup[] = [
    { title: 'Pilotage', links: [
      { href: '/admin', label: 'Tableau de bord', icon: 'dashboard' },
      ...(can('finance') ? [{ href: '/admin/rapports', label: 'Rapports et exports', icon: 'chart' }] : []),
    ] },
    { title: 'Opérations', links: [
      ...(can('stores') ? [{ href: '/admin/magasins', label: 'Supermarchés', icon: 'store' }] : []),
      ...(can('drivers') ? [{ href: '/admin/livreurs', label: 'Livreurs', icon: 'truck', badge: pendingDrivers }] : []),
      ...(can('support') ? [{ href: '/admin/messagerie', label: 'Messagerie', icon: 'chat', badge: openTickets }] : []),
    ] },
    { title: 'Finances', links: [
      ...(can('finance') ? [
        { href: '/admin/preuves', label: 'Preuves de paiement', icon: 'receipt', badge: pendingProofs },
        { href: '/admin/finances', label: 'Finances et budgets', icon: 'wallet' },
      ] : []),
    ] },
    { title: 'Marketing', links: [
      ...(user.isSuper ? [
        { href: '/admin/fidelite', label: 'Cartes fidélité', icon: 'card', badge: loyaltyToVerify },
        { href: '/admin/roue', label: 'Roue de la chance', icon: 'wheel', badge: giftsToHand },
        { href: '/admin/campagnes', label: 'Campagnes (push, WhatsApp, e-mail)', icon: 'megaphone' },
      ] : []),
      ...(can('marketing') ? [{ href: '/admin/marketing', label: 'Coupons, bannières, partenaires', icon: 'tag' }] : []),
    ] },
    { title: 'Administration', links: [
      ...(can('users') ? [{ href: '/admin/utilisateurs', label: 'Utilisateurs et rôles', icon: 'users' }] : []),
      ...(user.isSuper ? [
        { href: '/admin/agents', label: 'Agents et accès', icon: 'shield' },
        { href: '/admin/categories', label: 'Catégories', icon: 'layers' },
        { href: '/admin/taux', label: 'Taux de change', icon: 'exchange' },
        { href: '/admin/parametres', label: 'Logo et couleurs', icon: 'settings' },
      ] : []),
    ] },
  ];

  const regions = [...new Set(user.scopes.map((s) => scopeLabel(s)))];
  return (
    <Shell
      user={user}
      groups={groups}
      roleLabel={user.isSuper ? 'Administrateur général' : 'Agent Kin Marché'}
      subtitle={user.isSuper ? 'Toutes les régions' : regions.join(' · ')}
      searchAction="/admin/recherche"
    >
      {children}
    </Shell>
  );
}
