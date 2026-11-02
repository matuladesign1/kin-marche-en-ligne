import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { Button, Card, Row, Screen, T, type IconName } from '@/components/ui';
import type { TranslationKey } from '@/lib/i18n';
import { useSettings } from '@/providers/SettingsProvider';

type Status = 'granted' | 'denied' | 'undetermined';
interface Perm {
  key: string; icon: IconName; label: TranslationKey; use: TranslationKey;
  get: () => Promise<{ status: string; canAskAgain?: boolean }>;
  ask: () => Promise<unknown>;
}

const PERMS: Perm[] = [
  { key: 'camera', icon: 'camera-outline', label: 'perm.camera', use: 'perm.cameraUse',
    get: ImagePicker.getCameraPermissionsAsync, ask: ImagePicker.requestCameraPermissionsAsync },
  { key: 'photos', icon: 'images-outline', label: 'perm.photos', use: 'perm.photosUse',
    get: () => ImagePicker.getMediaLibraryPermissionsAsync(), ask: () => ImagePicker.requestMediaLibraryPermissionsAsync() },
  { key: 'location', icon: 'location-outline', label: 'perm.location', use: 'perm.locationUse',
    get: Location.getForegroundPermissionsAsync, ask: Location.requestForegroundPermissionsAsync },
  { key: 'notifications', icon: 'notifications-outline', label: 'perm.notifications', use: 'perm.notificationsUse',
    get: Notifications.getPermissionsAsync, ask: () => Notifications.requestPermissionsAsync() },
  { key: 'microphone', icon: 'mic-outline', label: 'perm.microphone', use: 'perm.microphoneUse',
    get: () => ExpoSpeechRecognitionModule.getPermissionsAsync(), ask: () => ExpoSpeechRecognitionModule.requestPermissionsAsync() },
];

export default function Permissions() {
  const { t, colors } = useSettings();
  const [state, setState] = useState<Record<string, { status: Status; canAskAgain: boolean }>>({});

  const refresh = useCallback(async () => {
    const entries = await Promise.all(PERMS.map(async (p) => {
      try {
        const r = await p.get();
        return [p.key, { status: (r.status as Status) ?? 'undetermined', canAskAgain: r.canAskAgain !== false }] as const;
      } catch {
        return [p.key, { status: 'undetermined' as Status, canAskAgain: true }] as const;
      }
    }));
    setState(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    refresh();
    // Les réglages du téléphone peuvent changer pendant que l'app est en arrière-plan.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  return (
    <Screen>
      {PERMS.map((p) => {
        const s = state[p.key];
        const granted = s?.status === 'granted';
        return (
          <Card key={p.key}>
            <Row>
              <Ionicons name={p.icon} size={24} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <T weight="700">{t(p.label)}</T>
                <T size="sm" muted>{t(p.use)}</T>
              </View>
              <T size="sm" weight="600" color={granted ? colors.success : s?.status === 'denied' ? colors.danger : colors.textMuted}>
                {t(`perm.${s?.status ?? 'undetermined'}` as TranslationKey)}
              </T>
            </Row>
            {!granted && s?.canAskAgain ? (
              <Button title={t('perm.allow')} variant="secondary" onPress={async () => { await p.ask(); refresh(); }} />
            ) : null}
          </Card>
        );
      })}
      <Button title={t('perm.openSettings')} icon="settings-outline" onPress={() => Linking.openSettings()} />
    </Screen>
  );
}
