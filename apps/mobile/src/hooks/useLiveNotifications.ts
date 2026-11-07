import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { showMissionCall } from '@/components/MissionCall';
import { showPromo } from '@/components/PromoPopup';
import { incomingCall } from '@/lib/kincall';
import { channelForKind, ensureChannels, isChatOpen, isCustomerOnlyKind, isPushActive, presentLocal } from '@/lib/notify';
import { supabase } from '@/lib/supabase';
import type { AppNotification, NotificationCategory } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { qk } from './data';

function categoryOf(kind: string): NotificationCategory | 'system' {
  if (kind === 'order_status' || kind === 'new_order' || kind === 'no_driver') return 'orders';
  if (kind === 'loyalty' || kind === 'wheel') return 'rewards';
  if (kind === 'message' || kind === 'ticket' || kind === 'pastry_message') return 'messages';
  if (kind === 'promo' || kind === 'marketing') return 'promos';
  return 'system';
}

/**
 * Notifications en direct : chaque notification enregistrée par le serveur (commande, paiement,
 * étapes de livraison, fidélité, roue…) met l'application à jour et s'affiche sur le téléphone.
 * Quand le push est actif (Firebase configuré), c'est le serveur qui l'affiche : pas de doublon.
 */
export function useLiveNotifications() {
  const { session, profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const refresh = useRef(refreshProfile);
  refresh.current = refreshProfile;
  const prefs = useRef(profile?.notification_prefs ?? {});
  prefs.current = profile?.notification_prefs ?? {};
  const role = useRef(profile?.role);
  role.current = profile?.role;

  useEffect(() => {
    if (!session) return;
    const uid = session.user.id;
    const ch = supabase
      .channel(`live-notifications-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (payload) => {
        const n = payload.new as AppNotification;
        // Espaces livreur et pâtissier : pas de notifications de client.
        if ((role.current === 'driver' || role.current === 'pastry_chef') && isCustomerOnlyKind(n.kind)) return;
        qc.invalidateQueries({ queryKey: qk.notifications });
        qc.invalidateQueries({ queryKey: qk.unread });
        if (n.kind === 'order_status' || n.kind === 'new_order') {
          qc.invalidateQueries({ queryKey: qk.orders });
          qc.invalidateQueries({ queryKey: qk.ordersToReview });
          const orderId = n.data?.order_id;
          if (typeof orderId === 'string') qc.invalidateQueries({ queryKey: qk.order(orderId) });
        }
        // Pâtisserie : demandes, prix, messages et étapes se mettent à jour partout.
        if (n.kind.startsWith('pastry_')) qc.invalidateQueries({ queryKey: ['pastry'] });
        // Accès pâtissier donné ou retiré : le rôle du compte change, l'application ouvre le bon espace.
        if (n.kind === 'pastry_role') refresh.current().catch(() => undefined);
        if (n.kind === 'wheel' || n.kind === 'loyalty') {
          qc.invalidateQueries({ queryKey: qk.wheel });
          qc.invalidateQueries({ queryKey: qk.loyalty });
          qc.invalidateQueries({ queryKey: qk.myCoupons });
        }

        // Nouvelle course proposée au livreur : écran d'appel (la sonnerie vient de la notification ci-dessous).
        if (n.kind === 'delivery_offer' || n.kind === 'call_test') {
          qc.invalidateQueries({ queryKey: ['driver-offers'] });
          if (AppState.currentState === 'active') showMissionCall();
          else {
            // Application en arrière-plan ou téléphone verrouillé : appel plein écran qui allume l'écran.
            const title = n.title;
            const body = n.body ?? '';
            ensureChannels().then(() => {
              if (!incomingCall.show(title, body, n.kind === 'call_test' ? 60_000 : 120_000)) {
                presentLocal({ title, body, data: { ...(n.data ?? {}), notification_id: n.id, kind: n.kind }, channel: 'missions_appel' });
              }
            });
            return;
          }
        }

        const cat = categoryOf(n.kind);
        if (cat !== 'system' && prefs.current?.[cat] === false) return;
        // Message de la conversation ouverte à l'écran : déjà visible, pas d'alerte.
        if (cat === 'messages' && isChatOpen(n.data?.ticket_id)) return;
        if (n.kind === 'pastry_message' && isChatOpen(`pastry:${String(n.data?.cake_order_id ?? '')}`)) return;
        // Promotion reçue application ouverte : grande carte avec la photo en entier.
        if (cat === 'promos' && AppState.currentState === 'active') { showPromo(n); return; }

        // Chaque notification s'affiche aussi sur le téléphone (bienvenue, messages de l'assistant et du livreur,
        // gains de la roue…), sauf si le push du serveur s'en charge déjà ou si le client a coupé cette catégorie.
        if (isPushActive()) return;
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
