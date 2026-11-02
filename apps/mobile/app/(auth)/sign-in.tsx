import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { BrandLogo } from '@/components/BrandHeader';
import { Button, Input, Notice, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

export default function SignIn() {
  const { t, colors } = useSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) return setError(t('common.required'));
    setLoading(true);
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (e) return setError(e.message === 'Invalid login credentials' ? '✕ ' + t('auth.password') + ' / ' + t('auth.email') : errorMessage(e, t));
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <BrandLogo height={64} />
        <T size="xl" weight="700" style={{ textAlign: 'center', marginTop: spacing.lg }}>{t('auth.signIn')}</T>
        {error ? <Notice tone="danger" text={error} /> : null}
        <Input label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        <Input label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" />
        <Button title={t('auth.signIn')} onPress={submit} loading={loading} />
        <Link href="/(auth)/forgot-password" style={{ color: colors.primary, textAlign: 'center' }}>{t('auth.forgot')}</Link>
        <T muted style={{ textAlign: 'center' }}>{t('auth.noAccount')}</T>
        <Button title={t('auth.signUp')} variant="ghost" onPress={() => router.push('/(auth)/sign-up')} />
        <Button title={t('tab.home')} variant="secondary" icon="storefront-outline" onPress={() => router.replace('/(customer)')} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
