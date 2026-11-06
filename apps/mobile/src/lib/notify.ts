import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

// Notifications affichées directement sur le téléphone.
// - « push » : envoyées par le serveur (fonctionne même application fermée, si Firebase est configuré au build) ;
// - « locales » : affichées par l'application elle-même (bienvenue, et suivi en direct quand le push n'est pas disponible).

export type NotificationChannel = 'orders' | 'missions' | 'general';

let channelsReady: Promise<void> | null = null;
let pushActive = false;

/** Canaux Android (importance haute = bannière en haut de l'écran). */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelsReady) {
    channelsReady = (async () => {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Commandes et livraisons', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250],
      });
      await Notifications.setNotificationChannelAsync('general', {
        name: 'Kin Marché', importance: Notifications.AndroidImportance.HIGH,
      });
      await Notifications.setNotificationChannelAsync('missions', {
        name: 'Missions de livraison', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400],
      });
    })().catch(() => {
      channelsReady = null;
    });
  }
  return channelsReady ?? Promise.resolve();
}

/** Demande l'autorisation si elle n'a jamais été demandée ; renvoie vrai si les notifications sont permises. */
export async function ensurePermission(ask = true): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!ask || !current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Le serveur peut-il joindre ce téléphone (jeton push enregistré) ? Évite les doublons avec les notifications locales. */
export function setPushActive(active: boolean): void {
  pushActive = active;
}
export function isPushActive(): boolean {
  return pushActive;
}

export function channelForKind(kind: string | undefined): NotificationChannel {
  if (kind === 'delivery_offer') return 'missions';
  if (kind === 'order_status' || kind === 'new_order' || kind === 'no_driver') return 'orders';
  return 'general';
}

/** Affiche immédiatement une notification sur le téléphone. */
export async function presentLocal(args: { title: string; body?: string | null; data?: Record<string, unknown>; channel?: NotificationChannel }): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (!(await ensurePermission())) return;
    await ensureChannels();
    const trigger = (Platform.OS === 'android' ? { channelId: args.channel ?? 'general' } : null) as Notifications.NotificationTriggerInput;
    await Notifications.scheduleNotificationAsync({
      // Petite icône : logo Kin Marché (rond découpé), teintée du rouge du logo.
      content: { title: args.title, body: args.body ?? undefined, data: args.data ?? {}, sound: 'default', color: '#1CB7B8' },
      trigger,
    });
  } catch {
    // Une notification qui ne s'affiche pas ne doit jamais casser l'application.
  }
}

/** Ouvre l'écran lié à une notification (liste « Messages » ou notification touchée sur le téléphone). */
export function openNotification(n: { kind: string; data?: Record<string, unknown> | null }): void {
  const d = n.data ?? {};
  const orderId = typeof d.order_id === 'string' ? d.order_id : null;
  const ticketId = typeof d.ticket_id === 'string' ? d.ticket_id : null;
  if (n.kind === 'wheel' || d.screen === 'wheel') router.push('/wheel');
  else if (n.kind === 'loyalty' || d.screen === 'loyalty') router.push('/loyalty');
  else if (n.kind === 'delivery_offer') router.push('/driver/offers');
  else if (ticketId) router.push(`/support/${ticketId}`);
  else if (orderId) router.push(`/order/${orderId}`);
  else if (n.kind === 'message') router.push('/support');
}
