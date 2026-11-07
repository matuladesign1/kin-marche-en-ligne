import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Input, Notice, Screen, T } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

export default function ForgotPassword() {
  const { t } = useSettings();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim()) return;
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: Linking.createURL('reset-password') });
    setLoading(false);
    // Même message dans tous les cas : on ne révèle pas si un compte existe.
    setSent(true);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <T size="xl" weight="700">{t('auth.forgot')}</T>
      {sent ? <Notice tone="success" text={t('auth.resetSent')} /> : null}
      <Input label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Button title={t('auth.resetSend')} onPress={submit} loading={loading} />
      <Button title={t('auth.signIn')} variant="ghost" onPress={() => router.replace('/(auth)/sign-in')} />
    </Screen>
  );
}
