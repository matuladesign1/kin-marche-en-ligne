import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export function useDriver() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['driver-me'],
    enabled: !!session,
    queryFn: async () => (await supabase.from('drivers').select('*').eq('id', session!.user.id).maybeSingle()).data as
      { id: string; driver_code: string; status: string; is_available: boolean; verified_at: string | null; province: string; city: string } | null,
  });
}

export interface Offer {
  assignment_id: string; order_id: string; order_number: string; store_name: string; store_commune: string | null;
  store_latitude: number | null; store_longitude: number | null;
  customer_commune: string | null; distance_km: number | null; delivery_fee_usd: number; items_count: number; weight_kg: number; expires_at: string;
}

export function useDriverOffers(enabled: boolean) {
  return useQuery({
    queryKey: ['driver-offers'],
    enabled,
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await supabase.rpc('get_driver_offers')) as Offer[],
  });
}

export interface ActiveMission {
  id: string; order_id: string; eta_minutes: number | null; route_distance_km: number | null; eta_target: string | null;
  orders: { order_number: string; status: string; delivery_fee_usd: number; delivery_address: Record<string, string>; stores: { name: string; commune: string | null } | null } | null;
}

export function useDriverActive() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['driver-active'],
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.from('delivery_assignments')
      .select('id, order_id, eta_minutes, route_distance_km, eta_target, orders(order_number, status, delivery_fee_usd, delivery_address, stores(name, commune))')
      .eq('driver_id', session!.user.id).eq('status', 'accepted').order('responded_at')) as unknown as ActiveMission[],
  });
}

/** Solde, courses livrées et gains du jour (heure de Kinshasa). */
export function useDriverToday() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['driver-today'],
    enabled: !!session,
    refetchInterval: 60_000,
    queryFn: async () => {
      const uid = session!.user.id;
      const kin = new Date(Date.now() + 60 * 60_000);          // UTC+1
      const start = new Date(Date.UTC(kin.getUTCFullYear(), kin.getUTCMonth(), kin.getUTCDate()) - 60 * 60_000).toISOString();
      const [wallet, done, tx] = await Promise.all([
        supabase.from('driver_wallets').select('balance_usd').eq('driver_id', uid).maybeSingle(),
        supabase.from('delivery_assignments').select('id', { count: 'exact', head: true }).eq('driver_id', uid).eq('status', 'completed').gte('delivered_at', start),
        supabase.from('driver_transactions').select('amount_usd, kind').eq('driver_id', uid).gte('created_at', start),
      ]);
      const earned = ((tx.data ?? []) as { amount_usd: number; kind: string }[])
        .filter((x) => x.kind !== 'payout').reduce((s, x) => s + Number(x.amount_usd), 0);
      return { balance: Number(wallet.data?.balance_usd ?? 0), deliveredToday: done.count ?? 0, earnedToday: earned };
    },
  });
}
