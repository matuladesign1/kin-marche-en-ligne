import { currentUser } from '@/lib/auth';
import { buildExport, csvResponse, readFilters } from '@/lib/reports';
import { managedStores } from '@/lib/store';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const user = await currentUser();
  if (user?.role !== 'store_admin') return new Response('Accès refusé', { status: 403 });
  const { type } = await params;
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filters = readFilters(sp);
  const stores = await managedStores(user.id);
  if (!filters.store || !stores.some((s) => s.id === filters.store)) filters.store = stores[0]?.id;
  if (!filters.store) return new Response('Aucun magasin', { status: 403 });
  const sb = await supabaseServer();
  const out = await buildExport(sb, type, filters, 'store');
  if (!out) return new Response('Export non disponible', { status: 404 });
  await sb.rpc('log_export', { p_type: type, p_filters: { ...sp, store: filters.store } });
  return csvResponse(out.name, out.csv);
}
