import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { channelForKind, isPushActive, presentLocal } from '@/lib/notify';
import { supabase } from '@/lib/supabase';
import type { AppNotification, NotificationCategory } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { qk } from './data';

function categoryOf(kind: string): NotificationCategory | 'system' {
  if (kind === 'order_status' || kind === 'new_order' || kind === 'no_driver') return 'orders';
  if (kind === 'loyalty' || kind === 'wheel') return 'rewards';
  if (kind === 'message' || kind === 'ticket') return 'messages';
  if (kind === 'promo' || kind === 'marketing') return 'promos';
  return 'system';
}

/**
 * Notifications en direct : chaque notification enregistrée par le serveur (commande, paiement,
 * étapes de livraison, fidélité, roue…) met l'application à jour et s'affiche sur le téléphone.
 * Quand le push est actif (Firebase configuré), c'est le serveur qui l'affiche : pas de doublon.
 */
export function useLiveNotifications() {
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const prefs = useRef(profile?.notification_prefs ?? {});
  prefs.current = profile?.notification_prefs ?? {};

  useEffect(() => {
    if (!session) return;
    const uid = session.user.id;
    const ch = supabase
      .channel(`live-notifications-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (payload) => {
        const n = payload.new as AppNotification;
        qc.invalidateQueries({ queryKey: qk.notifications });
        qc.invalidateQueries({ queryKey: qk.unread });
        if (n.kind === 'order_status' || n.kind === 'new_order') {
          qc.invalidateQueries({ queryKey: qk.orders });
          qc.invalidateQueries({ queryKey: qk.ordersToReview });
          const orderId = n.data?.order_id;
          if (typeof orderId === 'string') qc.invalidateQueries({ queryKey: qk.order(orderId) });
        }
        if (n.kind === 'wheel' || n.kind === 'loyalty') {
          qc.invalidateQueries({ queryKey: qk.wheel });
          qc.invalidateQueries({ queryKey: qk.loyalty });
          qc.invalidateQueries({ queryKey: qk.myCoupons });
        }

        // Affichage sur le téléphone (sauf si le serveur s'en charge déjà ou si le client l'a désactivé).
        if (isPushActive() || n.data?.push === false || n.kind === 'welcome') return;
        const cat = categoryOf(n.kind);
        if (cat !== 'system' && prefs.current?.[cat] === false) return;
        presentLocal({
          title: n.title,
          body: n.body,
          data: { ...(n.data ?? {}), notification_id: n.id, kind: n.kind },
          channel: channelForKind(n.kind),
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, qc]);
}
