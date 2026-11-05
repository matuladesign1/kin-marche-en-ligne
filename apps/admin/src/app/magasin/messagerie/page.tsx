import { Messaging, parseFilter } from '@/components/Messaging';
import { requireRole } from '@/lib/auth';
import { currentStore } from '@/lib/store';
import { StorePicker } from '../StorePicker';

export default async function MessagerieMagasin({ searchParams }: {
  searchParams: Promise<{ t?: string; f?: string; q?: string; new?: string; store?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireRole('store_admin');
  const { stores, store } = await currentStore(user.id, sp.store);
  if (!store) return null;
  return (
    <>
      <h1>Messagerie — {store.name}</h1>
      <p className="page-sub">Clients de vos commandes (vous répondez en tant que « ASSISTANT {store.name} ») et échanges internes avec la Direction de Kin Marché.</p>
      <StorePicker stores={stores} current={store.id} path="/magasin/messagerie" />
      <Messaging base="/magasin/messagerie" userId={user.id} viewer="store" ticketId={sp.t} filter={parseFilter(sp.f)}
        q={sp.q} showNew={sp.new === '1'} storeId={store.id} stores={[store]} err={sp.err} />
    </>
  );
}
