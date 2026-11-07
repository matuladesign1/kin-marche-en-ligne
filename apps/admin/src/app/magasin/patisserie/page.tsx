import { PastrySpace } from '@/components/pastry/PastrySpace';
import { requireRole } from '@/lib/auth';
import { managedStores } from '@/lib/store';

// Pâtisserie du supermarché : la direction donne l'accès à ses pâtissiers, les suspend et suit les commandes.
export default async function PatisserieMagasin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('store_admin');
  const sp = await searchParams;
  const stores = (await managedStores(user.id)).map((s) => ({ id: s.id, name: s.name }));
  return <PastrySpace base="/magasin/patisserie" user={user} stores={stores} sp={sp} />;
}
