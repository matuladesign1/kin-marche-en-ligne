import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { enabledProviders, signInWithProvider, type OAuthProvider } from '@/lib/oauth';
import { radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';
import { Notice, T } from './ui';

/** Boutons Google / Facebook : seulement ceux que le serveur a réellement activés. */
export function SocialLogin() {
  const { t, colors } = useSettings();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined = vérification en cours ; null = serveur injoignable (on affiche les deux boutons).
  const [enabled, setEnabled] = useState<Record<OAuthProvider, boolean> | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    enabledProviders().then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);

  const go = async (p: OAuthProvider) => {
    setBusy(p);
    setError(null);
    const r = await signInWithProvider(p);
    setBusy(null);
    if (r.ok) router.replace('/');
    else if (r.error !== 'CANCELLED') {
      setError(r.error === 'PROVIDER_DISABLED' || /not enabled|unsupported provider|provider is not/i.test(r.error ?? '')
        ? t('auth.providerDisabled') : t('auth.socialFailed'));
    }
  };

  if (enabled === undefined) return null;
  const showGoogle = enabled === null || enabled.google;
  const showFacebook = enabled === null || enabled.facebook;
  if (!showGoogle && !showFacebook) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <T size="sm" muted style={{ textAlign: 'center' }}>{t('auth.orContinueWith')}</T>
      {showGoogle ? (
        <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => go('google')}
          style={[styles.btn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}>
          <Ionicons name="logo-google" size={20} color="#DB4437" />
          <T weight="600">{busy === 'google' ? t('common.loading') : t('auth.withGoogle')}</T>
        </Pressable>
      ) : null}
      {showFacebook ? (
        <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => go('facebook')}
          style={[styles.btn, { backgroundColor: '#1877F2', borderColor: '#1877F2', opacity: busy ? 0.6 : 1 }]}>
          <Ionicons name="logo-facebook" size={20} color="#FFFFFF" />
          <T weight="600" color="#FFFFFF">{busy === 'facebook' ? t('common.loading') : t('auth.withFacebook')}</T>
        </Pressable>
      ) : null}
      {error ? <Notice tone="warning" text={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48, borderRadius: radius.md, borderWidth: 1 },
});
