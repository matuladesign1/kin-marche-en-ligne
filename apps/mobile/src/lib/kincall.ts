import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

// Module natif « KinCall » (modules/kin-call) : nouvelle course affichée comme un appel entrant
// (notification plein écran qui allume l'écran, par-dessus l'écran verrouillé, sonnerie répétée).
type KinCallNative = {
  showIncomingCall(title: string, body: string, timeoutMs: number): void;
  cancelIncomingCall(): void;
  releaseLockScreen(): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenSettings(): void;
};

const native = Platform.OS === 'android' ? requireOptionalNativeModule<KinCallNative>('KinCall') : null;

export const incomingCall = {
  /** Affiche l'appel plein écran ; false si le module n'est pas disponible (ancienne version). */
  show(title: string, body: string, timeoutMs: number): boolean {
    if (!native) return false;
    try { native.showIncomingCall(title, body, timeoutMs); return true; } catch { return false; }
  },
  /** Arrête la sonnerie et rend l'écran verrouillé normal. */
  cancel(): void {
    try { native?.cancelIncomingCall(); } catch { /* rien */ }
  },
  /** Android 14+ : l'autorisation « notifications plein écran » est-elle accordée ? */
  canUseFullScreen(): boolean {
    try { return native ? native.canUseFullScreenIntent() : true; } catch { return true; }
  },
  openSettings(): void {
    try { native?.openFullScreenSettings(); } catch { /* rien */ }
  },
};
