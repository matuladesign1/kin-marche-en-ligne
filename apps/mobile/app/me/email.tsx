import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Button, Input, Notice, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function ChangeEmail() {
  const { t } = useSettings();
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  if (!session) return <Redirect href="/(auth)/sign-in" />;

  const submit = async () => {
    setMsg(null);
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setMsg({ tone: 'danger', text: t('common.required') });
    setBusy(true);
    try {
      // Supabase envoie un lien de confirmation ; l'adresse ne change qu'après confirmation.
      const { error } = await supabase.auth.updateUser({ email: value }, { emailRedirectTo: Linking.createURL('auth-callback') });
      if (error) throw error;
      setMsg({ tone: 'success', text: t('account.emailSent') });
      setEmail('');
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Input label={t('auth.email')} value={session.user.email ?? ''} editable={false} />
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      <Input label={t('account.newEmail')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Button title={t('common.confirm')} icon="mail-outline" loading={busy} onPress={submit} />
    </Screen>
  );
}
