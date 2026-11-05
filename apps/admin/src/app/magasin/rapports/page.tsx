import { Reports } from '@/components/Reports';
import { requireRole } from '@/lib/auth';
import { readFilters } from '@/lib/reports';
import { managedStores } from '@/lib/store';
import { supabaseServer } from '@/lib/supabase-server';

export default async function RapportsMagasin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole('store_admin');
  const stores = await managedStores(user.id);
  const filters = readFilters(await searchParams);
  // Un directeur ne voit que ses magasins (la RLS l'impose aussi côté base).
  if (!filters.store || !stores.some((s) => s.id === filters.store)) filters.store = stores[0]?.id;
  const sb = await supabaseServer();
  return (
    <>
      <h1>Rapports</h1>
      <Reports sb={sb} filters={filters} scope="store" basePath="/magasin" stores={stores} />
    </>
  );
}
