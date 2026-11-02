import { Messaging } from '@/components/Messaging';
import { requireRole } from '@/lib/auth';
import { currentStore } from '@/lib/store';
import { StorePicker } from '../StorePicker';

export default async function MessagerieMagasin({ searchParams }: { searchParams: Promise<{ t?: string; f?: string; store?: string; err?: string }> }) {
  const sp = await searchParams;
  const user = await requireRole('store_admin');
  const { stores, store } = await currentStore(user.id, sp.store);
  if (!store) return null;
  const filter = sp.f === 'customers' || sp.f === 'internal' ? sp.f : 'all';
  return (
    <>
      <h1>Messagerie — {store.name}</h1>
      <p className="muted">Clients de vos commandes et échanges internes avec la Direction de Kin Marché.</p>
      <StorePicker stores={stores} current={store.id} path="/magasin/messagerie" />
      <Messaging base="/magasin/messagerie" userId={user.id} ticketId={sp.t} filter={filter} storeId={store.id} stores={[store]} err={sp.err} />
    </>
  );
}
