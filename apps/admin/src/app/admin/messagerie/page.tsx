import { Messaging, parseFilter } from '@/components/Messaging';
import { inScope, requirePermission, scopeLabel } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase-server';

export default async function MessagerieAdmin({ searchParams }: {
  searchParams: Promise<{ t?: string; f?: string; q?: string; new?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const user = await requirePermission('support');
  const sb = await supabaseServer();
  const { data: rows } = await sb.from('stores').select('id, name, province, city, commune').eq('is_active', true).order('name');
  // Un agent n'ouvre un fil interne qu'avec les supermarchés de sa zone (la base le vérifie aussi).
  const stores = (rows ?? []).filter((s) => inScope(user, 'support', s)).map(({ id, name }) => ({ id, name }));
  const zones = user.isSuper ? null : user.scopes.filter((s) => s.permission === 'support').map(scopeLabel).join(' · ');
  return (
    <>
      <h1>Messagerie</h1>
      <p className="page-sub">
        Demandes des clients et fils internes avec les supermarchés{zones ? <> — zone : <b>{zones}</b></> : null}.
        Les réponses partent sous le nom certifié « ASSISTANT (ville) ».
      </p>
      <Messaging base="/admin/messagerie" userId={user.id} viewer="direction" ticketId={sp.t} filter={parseFilter(sp.f)}
        q={sp.q} showNew={sp.new === '1'} storeId={null} stores={stores} err={sp.err} />
    </>
  );
}
