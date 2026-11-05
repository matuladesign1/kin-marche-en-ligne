import { currentUser } from '@/lib/auth';
import { buildExport, csvResponse, readFilters } from '@/lib/reports';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const user = await currentUser();
  if (!user || !user.permissions.includes('finance')) return new Response('Accès refusé', { status: 403 });
  const { type } = await params;
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const sb = await supabaseServer();
  const out = await buildExport(sb, type, readFilters(sp), 'admin');
  if (!out) return new Response('Export inconnu', { status: 404 });
  await sb.rpc('log_export', { p_type: type, p_filters: sp });
  return csvResponse(out.name, out.csv);
}
