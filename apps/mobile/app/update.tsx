import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KM_RED, KM_TURQUOISE, LoadingDots, LoadingScreen } from '@/components/KinLoader';
import { useAppUpdate } from '@/hooks/data';
import { useSettings } from '@/providers/SettingsProvider';

type Phase = 'checking' | 'downloading' | 'done' | 'error' | 'latest';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Mise à jour de l'application : téléchargement de l'APK dans l'application, avec la même animation
 * que le démarrage et la progression RÉELLE (octets reçus / taille du fichier), puis installation.
 */
export default function UpdateScreen() {
  const { t, language } = useSettings();
  const insets = useSafeAreaInsets();
  const build = Number(Application.nativeBuildVersion) || null;
  const update = useAppUpdate(build);
  const [phase, setPhase] = useState<Phase>('checking');
  const [written, setWritten] = useState(0);
  const [total, setTotal] = useState(0);
  const [installFailed, setInstallFailed] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const job = useRef<FileSystem.DownloadResumable | null>(null);
  const file = useRef<string | null>(null);
  const alive = useRef(true);
  const lastTick = useRef(0);

  const mb = (bytes: number) => {
    const n = (bytes / 1048576).toFixed(1);
    return t('update.mb', { n: language === 'en' ? n : n.replace('.', ',') });
  };
  const pct = total > 0 ? Math.min(100, Math.floor((written / total) * 100)) : 0;

  useEffect(() => {
    Animated.timing(progress, { toValue: pct / 100, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [pct, progress]);

  const install = useCallback(async () => {
    if (!file.current) return;
    setInstallFailed(false);
    try {
      const data = await FileSystem.getContentUriAsync(file.current);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data, flags: FLAG_GRANT_READ_URI_PERMISSION, type: 'application/vnd.android.package-archive',
      });
    } catch {
      if (alive.current) setInstallFailed(true);
    }
  }, []);

  const start = useCallback(async () => {
    const info = update.data;
    if (!info) return;
    if (Platform.OS !== 'android' || !info.apkUrl) {
      Linking.openURL(info.url).catch(() => undefined);
      router.back();
      return;
    }
    const target = `${FileSystem.cacheDirectory}KinMarche-${info.build}.apk`;
    file.current = target;
    setPhase('downloading');
    setWritten(0);
    setTotal(info.size);
    setInstallFailed(false);
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    const dl = FileSystem.createDownloadResumable(info.apkUrl, target, {}, (p) => {
      if (!alive.current) return;
      const expected = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : info.size;
      const now = Date.now();
      // Environ 8 mises à jour par seconde : progression fluide sans surcharger le téléphone.
      if (now - lastTick.current < 120 && p.totalBytesWritten < expected) return;
      lastTick.current = now;
      setWritten(p.totalBytesWritten);
      setTotal(expected);
    });
    job.current = dl;
    try {
      const res = await dl.downloadAsync();
      if (!alive.current) return;
      if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status ?? '?'}`);
      const saved = await FileSystem.getInfoAsync(target);
      if (!saved.exists || !saved.size || (info.size > 0 && saved.size !== info.size)) throw new Error('INCOMPLETE');
      setWritten(saved.size);
      setTotal(saved.size);
      setPhase('done');
      install();
    } catch {
      if (!alive.current) return;
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      setPhase('error');
    }
  }, [update.data, install]);

  // Démarre dès que la dernière version est connue (aucune attente artificielle).
  useEffect(() => {
    if (phase !== 'checking' || update.isLoading) return;
    if (!update.data) setPhase('error');
    else if (!update.data.newer) setPhase('latest');
    else start();
  }, [phase, update.isLoading, update.data, start]);

  // Quitter l'écran arrête le téléchargement.
  useEffect(() => () => {
    alive.current = false;
    job.current?.pauseAsync().catch(() => undefined);
  }, []);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const retry = () => { if (update.data) start(); else { update.refetch(); setPhase('checking'); } };

  let body;
  if (phase === 'checking') {
    body = (
      <>
        <LoadingDots />
        <Text style={styles.status}>{t('update.checking')}</Text>
      </>
    );
  } else if (phase === 'latest') {
    body = (
      <>
        <Ionicons name="checkmark-circle" size={36} color="#FFFFFF" />
        <Text style={styles.status}>{t('update.latest')}</Text>
        <Action label={t('common.close')} onPress={close} />
      </>
    );
  } else if (phase === 'error') {
    body = (
      <>
        <Ionicons name="cloud-offline-outline" size={36} color="#FFFFFF" />
        <Text style={styles.status}>{update.data ? t('update.error') : t('update.checkError')}</Text>
        <Action label={t('common.retry')} onPress={retry} />
        <Action label={t('common.close')} onPress={close} ghost />
      </>
    );
  } else {
    body = (
      <>
        {update.data ? <Text style={styles.version}>{t('update.newVersion', { n: update.data.build })}</Text> : null}
        <View style={styles.row}>
          <Text style={styles.label}>{phase === 'done' ? t('update.done') : t('update.downloading')}</Text>
          <Text style={styles.pct}>{pct} %</Text>
        </View>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
          <Animated.View style={[styles.fill, { transform: [{ scaleX: progress }] }]} />
        </View>
        <Text style={styles.bytes}>{t('update.bytes', { done: mb(written), total: total > 0 ? mb(total) : '…' })}</Text>
        {phase === 'done' ? (
          <>
            <Action label={t('update.install')} onPress={install} />
            <Text style={styles.hint}>{installFailed ? t('update.installError') : t('update.installHint')}</Text>
          </>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <LoadingScreen>
        <View style={styles.panel}>{body}</View>
      </LoadingScreen>
      <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}
        style={[styles.closeBtn, { top: insets.top + 8 }]}>
        <Ionicons name="close" size={26} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

function Action({ label, onPress, ghost }: { label: string; onPress: () => void; ghost?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.action, ghost ? styles.actionGhost : null, { opacity: pressed ? 0.85 : 1 }]}>
      <Text style={[styles.actionText, ghost ? { color: '#FFFFFF' } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { alignSelf: 'stretch', alignItems: 'center', gap: 12, maxWidth: 420, width: '100%' },
  status: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  version: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', alignSelf: 'stretch' },
  label: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  pct: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  track: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', backgroundColor: KM_TURQUOISE, borderRadius: 5, transformOrigin: 'left' },
  bytes: { color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600', alignSelf: 'flex-start', fontVariant: ['tabular-nums'] },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'center', lineHeight: 17 },
  action: { marginTop: 4, minWidth: 220, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 999, backgroundColor: '#FFFFFF', alignItems: 'center' },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  actionText: { color: KM_RED, fontSize: 15, fontWeight: '800' },
  closeBtn: { position: 'absolute', left: 14, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
});
