import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { ensureChannels, ensurePermission, isChatOpen, openNotification, setPushActive } from '@/lib/notify';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

Notifications.setNotificationHandler({
  // Application ouverte : un message de la conversation affichée ne sonne pas ;
  // une promotion s'affiche en grande carte dans l'application (PromoPopup) plutôt qu'en bandeau.
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
    const quiet = (data.kind === 'message' && isChatOpen(data.ticket_id)) || data.kind === 'promo';
    return { shouldShowBanner: !quiet, shouldShowList: true, shouldPlaySound: !quiet, shouldSetBadge: false };
  },
});

/**
 * Enregistre le jeton push du téléphone dans push_tokens : le serveur peut alors joindre
 * le téléphone même application fermée. Nécessite le projet Expo (EAS_PROJECT_ID) et, sur Android,
 * le fichier Firebase (google-services.json) fournis au build — sinon les notifications passent
 * par l'application ouverte (voir useLiveNotifications).
 */
export function usePushRegistration() {
  const { session } = useAuth();
  useEffect(() => {
    if (!session || Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      await ensureChannels();
      const granted = await ensurePermission(true);
      if (!granted || !Device.isDevice) return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId) return; // EAS_PROJECT_ID fourni au build (voir README)
      try {
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        const { error } = await supabase.from('push_tokens').upsert({ token, user_id: session.user.id, platform: Platform.OS });
        if (!cancelled && !error) setPushActive(true);
      } catch {
        // Firebase absent du build : les notifications restent affichées par l'application ouverte.
        setPushActive(false);
      }
    })();
    return () => { cancelled = true; setPushActive(false); };
  }, [session]);
}

/** Ouvre l'écran concerné quand l'utilisateur touche une notification (push ou locale). */
export function useNotificationNavigation() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      const kind = typeof data.kind === 'string' ? data.kind : '';
      openNotification({ kind, data });
    });
    return () => sub.remove();
  }, []);
}
