import { Reports } from '@/components/Reports';
import { readFilters } from '@/lib/reports';
import { supabaseServer } from '@/lib/supabase-server';

export default async function Rapports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = readFilters(await searchParams);
  const sb = await supabaseServer();
  const { data: stores } = await sb.from('stores').select('id, name').order('name');
  return (
    <>
      <h1>Rapports</h1>
      <Reports sb={sb} filters={filters} scope="admin" basePath="/admin" stores={stores ?? []} />
    </>
  );
}
