import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

/** « Je recommande » : un client recommande un produit (une fois), le compteur est tenu par le serveur. */
export function useRecommendation(productId: string | undefined) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ['reco', productId],
    enabled: !!session && !!productId,
    queryFn: async () => !!(await supabase.from('product_recommendations').select('product_id')
      .eq('product_id', productId!).eq('user_id', session!.user.id).maybeSingle()).data,
  });
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) unwrap(await supabase.from('product_recommendations').insert({ user_id: session!.user.id, product_id: productId! }));
      else unwrap(await supabase.from('product_recommendations').delete().eq('user_id', session!.user.id).eq('product_id', productId!));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reco', productId] });
      qc.invalidateQueries({ queryKey: ['catalog-item'] });
    },
  });
  return { recommended: !!mine.data, toggle };
}

/** Commande livrée contenant ce produit et pas encore évaluée : le client peut laisser son avis. */
export function useReviewableOrder(productId: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['reviewable', productId],
    enabled: !!session && !!productId,
    queryFn: async () => {
      const uid = session!.user.id;
      const { data: lines } = await supabase.from('order_items').select('order_id, orders!inner(status, customer_id, created_at)')
        .eq('product_id', productId!).eq('orders.customer_id', uid).in('orders.status', ['delivered', 'completed']);
      const orderIds = [...new Set(((lines ?? []) as { order_id: string }[]).map((l) => l.order_id))];
      if (!orderIds.length) return null;
      const { data: done } = await supabase.from('reviews').select('order_id')
        .eq('author_id', uid).eq('product_id', productId!).eq('target_type', 'product');
      const reviewed = new Set(((done ?? []) as { order_id: string }[]).map((r) => r.order_id));
      return orderIds.find((id) => !reviewed.has(id)) ?? null;
    },
  });
}
