import { currentUser } from '@/lib/auth';
import { SYNC_KIND_FR, TIER_FR } from '@/lib/loyalty';
import { csvResponse, toCsv } from '@/lib/reports';
import { supabaseServer } from '@/lib/supabase-server';

// Export CSV des opérations à reporter dans l'espace Kin Marché Fidélité.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user?.isSuper) return new Response('Accès refusé', { status: 403 });
  const f = new URL(request.url).searchParams.get('f');
  const status = f && ['pending', 'sent', 'skipped'].includes(f) ? f : 'pending';
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('admin_loyalty_sync_queue', { p_status: status, p_limit: 2000 });
  if (error) return new Response(error.message, { status: 500 });
  const d = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }) : '');
  const rows = ((data?.rows ?? []) as any[]).map((r) => [
    r.id, d(r.created_at), SYNC_KIND_FR[r.kind] ?? r.kind, r.card_number, r.full_name ?? r.details?.full_name ?? '',
    r.details?.phone ?? '', r.points || '', TIER_FR[r.tier] ?? r.tier ?? '',
    r.card_status === 'suspended' ? 'Suspendue' : r.card_status === 'active' ? 'Active' : '',
    r.reference ?? '', r.details?.note ?? '',
  ]);
  const day = new Date().toISOString().slice(0, 10);
  return csvResponse(`kin-marche-fidelite-operations-${status}-${day}`, toCsv(
    ['N°', 'Date', 'Opération', 'Numéro de carte', 'Nom', 'Téléphone', 'Points', 'Niveau', 'Statut de la carte', 'Référence', 'Note'], rows));
}
