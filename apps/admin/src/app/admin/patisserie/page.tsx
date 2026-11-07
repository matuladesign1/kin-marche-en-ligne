import { PastrySpace } from '@/components/pastry/PastrySpace';
import { inScope, requirePermission } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase-server';

// Pâtisserie (administration) : administrateur général (tous les supermarchés, certification, réglages)
// et agents « Supermarchés » (supermarchés de leur zone).
export default async function Patisserie({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission('stores');
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data } = await sb.from('stores').select('id, name, province, city, commune').eq('is_active', true).order('name');
  const stores = (data ?? []).filter((s) => inScope(user, 'stores', s)).map((s) => ({ id: s.id as string, name: s.name as string }));
  return <PastrySpace base="/admin/patisserie" user={user} stores={stores} sp={sp} />;
}
