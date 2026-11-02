import { Messaging } from '@/components/Messaging';
import { requireRole } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase-server';

export default async function MessagerieAdmin({ searchParams }: { searchParams: Promise<{ t?: string; f?: string; store?: string; err?: string }> }) {
  const sp = await searchParams;
  const user = await requireRole('super_admin');
  const sb = await supabaseServer();
  const { data: stores } = await sb.from('stores').select('id, name').order('name');
  const filter = sp.f === 'customers' || sp.f === 'internal' ? sp.f : 'all';
  return (
    <>
      <h1>Messagerie</h1>
      <p className="muted">Demandes des clients et fils internes avec les directeurs et assistants des supermarchés.</p>
      <Messaging base="/admin/messagerie" userId={user.id} ticketId={sp.t} filter={filter} storeId={null} stores={stores ?? []} err={sp.err} />
    </>
  );
}
