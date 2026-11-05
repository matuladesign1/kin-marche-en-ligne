import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Button, Input, Notice, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function ChangePassword() {
  const { t } = useSettings();
  const { session } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  if (!session) return <Redirect href="/(auth)/sign-in" />;
  const providers = (session.user.app_metadata?.providers as string[] | undefined) ?? [session.user.app_metadata?.provider as string];
  const hasPassword = providers.includes('email');
  const email = session.user.email ?? '';

  const submit = async () => {
    setMsg(null);
    if (next.length < 8) return setMsg({ tone: 'danger', text: t('auth.passwordRule') });
    if (next !== confirm) return setMsg({ tone: 'danger', text: t('account.passwordMismatch') });
    setBusy(true);
    try {
      // Vérifie le mot de passe actuel avant toute modification.
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) return setMsg({ tone: 'danger', text: t('account.passwordWrong') });
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setCurrent(''); setNext(''); setConfirm('');
      setMsg({ tone: 'success', text: t('account.passwordSaved') });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };

  if (!hasPassword) {
    return (
      <Screen>
        <Notice text={t('account.passwordSocial')} />
        <Button title={t('auth.forgot')} variant="secondary" onPress={() => router.push('/(auth)/forgot-password')} />
      </Screen>
    );
  }

  return (
    <Screen>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      <Input label={t('account.currentPassword')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <Input label={t('account.newPassword')} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" placeholder={t('auth.passwordRule')} />
      <Input label={t('account.confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      <Button title={t('common.save')} icon="key-outline" loading={busy} onPress={submit} />
      <Button title={t('auth.forgot')} variant="ghost" onPress={() => router.push('/(auth)/forgot-password')} />
    </Screen>
  );
}
