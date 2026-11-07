import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import type { PastryChef, PastryChefCard, PastryMessage, PastryOrder, PastrySettings, PastryStore } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Pâtisserie : demandes des clients, espace pâtissier, discussion — mises à jour en temps réel.

const ORDER_SELECT = '*, stores(name)';

/** Réglages (ouverture des commandes, délai minimum en heures), modifiables par l'administrateur général. */
export function usePastrySettings() {
  return useQuery({
    queryKey: ['pastry', 'settings'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PastrySettings> => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'pastry').maybeSingle();
      const v = (data?.value ?? {}) as Partial<PastrySettings>;
      const lead = Number(v.min_lead_hours);
      return { enabled: v.enabled !== false, min_lead_hours: Number.isFinite(lead) && lead >= 0 ? lead : 3 };
    },
  });
}

/** Supermarchés qui ont au moins un pâtissier actif. */
export function usePastryStores() {
  return useQuery({
    queryKey: ['pastry', 'stores'],
    staleTime: 60_000,
    queryFn: async () => (unwrap(await supabase.rpc('pastry_stores')) ?? []) as PastryStore[],
  });
}

/** Demandes du client connecté. */
export function useMyPastryOrders() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel(`pastry-mine-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cake_orders', filter: `customer_id=eq.${uid}` }, () => {
        qc.invalidateQueries({ queryKey: ['pastry', 'mine'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);
  return useQuery({
    queryKey: ['pastry', 'mine', uid],
    enabled: !!uid,
    queryFn: async () => unwrap(await supabase.from('cake_orders').select(ORDER_SELECT)
      .eq('customer_id', uid!).order('created_at', { ascending: false }).limit(100)) as PastryOrder[],
  });
}

/** Une demande (client ou pâtissier), avec ses messages ; tout se met à jour en direct. */
export function usePastryOrder(id: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`pastry-order-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cake_orders', filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ['pastry', 'order', id] });
        qc.invalidateQueries({ queryKey: ['pastry', 'mine'] });
        qc.invalidateQueries({ queryKey: ['pastry', 'chef-orders'] });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pastry_messages', filter: `cake_order_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ['pastry', 'messages', id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);
  return useQuery({
    queryKey: ['pastry', 'order', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('cake_orders').select(ORDER_SELECT).eq('id', id!).maybeSingle()) as PastryOrder | null,
  });
}

export function usePastryMessages(id: string | undefined) {
  return useQuery({
    queryKey: ['pastry', 'messages', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('pastry_messages').select('*')
      .eq('cake_order_id', id!).order('created_at', { ascending: true }).limit(500)) as PastryMessage[],
  });
}

/** Carte publique du pâtissier qui s'occupe de la commande. */
export function usePastryChefCard(chefId: string | null | undefined) {
  return useQuery({
    queryKey: ['pastry', 'chef-card', chefId],
    enabled: !!chefId,
    staleTime: 10 * 60_000,
    queryFn: async () => (unwrap(await supabase.rpc('pastry_chef_card', { p_chef: chefId })) ?? null) as PastryChefCard | null,
  });
}

/** Fiche du pâtissier connecté (null si l'accès n'a pas été donné). */
export function useMyPastryChef() {
  const { session, profile } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ['pastry', 'me', uid],
    enabled: !!uid && profile?.role === 'pastry_chef',
    queryFn: async () => unwrap(await supabase.from('pastry_chefs').select('*, stores(name)').eq('id', uid!).maybeSingle()) as PastryChef | null,
  });
}

/** Commandes du supermarché du pâtissier (les règles d'accès du serveur ne renvoient que celles-ci). */
export function useChefOrders(storeId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!storeId) return;
    const ch = supabase.channel(`pastry-store-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cake_orders', filter: `store_id=eq.${storeId}` }, () => {
        qc.invalidateQueries({ queryKey: ['pastry', 'chef-orders'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId, qc]);
  return useQuery({
    queryKey: ['pastry', 'chef-orders', storeId],
    enabled: !!storeId,
    refetchInterval: 120_000,
    queryFn: async () => unwrap(await supabase.from('cake_orders').select(ORDER_SELECT)
      .eq('store_id', storeId!).order('created_at', { ascending: false }).limit(300)) as PastryOrder[],
  });
}

/** Lien temporaire vers une photo privée (photo de référence, pièce d'identité). */
export function useSignedUrl(bucket: string, path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', bucket, path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path!, 3600);
      if (error) return null;
      return data?.signedUrl ?? null;
    },
  });
}
