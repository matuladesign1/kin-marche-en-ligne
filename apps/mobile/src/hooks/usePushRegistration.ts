import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
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
        }
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
        if (!projectId) return; // nécessite « eas init » (voir README)
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        await supabase.from('push_tokens').upsert({ token, user_id: session.user.id, platform: Platform.OS });
      } catch {
        // Les notifications restent visibles dans l'application même sans push.
      }
    })();
  }, [session]);
}
