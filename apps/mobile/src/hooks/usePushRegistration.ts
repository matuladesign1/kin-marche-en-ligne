import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Enregistre le jeton Expo Push du téléphone dans push_tokens (envoi côté serveur). */
export function usePushRegistration() {
  const { session } = useAuth();
  useEffect(() => {
    if (!session || Platform.OS === 'web' || !Device.isDevice) return;
    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        const status = existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status;
        if (status !== 'granted') return;
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('orders', {
            name: 'Commandes', importance: Notifications.AndroidImportance.HIGH,
          });
          await Notifications.setNotificationChannelAsync('missions', {
            name: 'Missions de livraison', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400],
          });
        }
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
        if (!projectId) return; // EAS_PROJECT_ID fourni au build (voir README)
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        await supabase.from('push_tokens').upsert({ token, user_id: session.user.id, platform: Platform.OS });
      } catch {
        // Les notifications restent visibles dans l'application même sans push.
      }
    })();
  }, [session]);
}

/** Ouvre l'écran concerné quand l'utilisateur touche une notification. */
export function useNotificationNavigation() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { order_id?: string; ticket_id?: string; kind?: string; screen?: string } | undefined;
      if (data?.kind === 'delivery_offer') router.push('/driver/offers');
      else if (data?.kind === 'loyalty' || data?.screen === 'loyalty') router.push('/loyalty');
      else if (data?.ticket_id) router.push(`/support/${data.ticket_id}`);
      else if (data?.order_id) router.push(`/order/${data.order_id}`);
    });
    return () => sub.remove();
  }, []);
}
