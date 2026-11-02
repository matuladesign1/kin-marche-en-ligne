import { supabaseServer } from './supabase-server';

/** Magasins gérés par l'utilisateur connecté (RLS : uniquement les siens). */
export async function managedStores(userId: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from('store_managers').select('store_id, title, stores(id, name, commune)').eq('user_id', userId);
  return (data ?? []).map((r: any) => ({ id: r.store_id as string, name: r.stores?.name as string, commune: r.stores?.commune as string | null, title: r.title as string }));
}

export async function currentStore(userId: string, requested?: string) {
  const stores = await managedStores(userId);
  return { stores, store: stores.find((s) => s.id === requested) ?? stores[0] ?? null };
}
