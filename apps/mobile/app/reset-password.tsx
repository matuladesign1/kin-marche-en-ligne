import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Input, Loading, Notice, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { exchangeCode } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

// Lien « mot de passe oublié » reçu par e-mail : le code ouvre une session de récupération,
// puis le client choisit son nouveau mot de passe (sans l'ancien).
export default function ResetPassword() {
  const { t } = useSettings();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [ready, setReady] = useState<boolean | null>(code ? null : false);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    exchangeCode(String(code)).then((r) => { if (alive) setReady(r.ok); });
    return () => { alive = false; };
  }, [code]);

  const submit = async () => {
    setMsg(null);
    if (next.length < 8) return setMsg({ tone: 'danger', text: t('auth.passwordRule') });
    if (next !== confirm) return setMsg({ tone: 'danger', text: t('account.passwordMismatch') });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) return setMsg({ tone: 'danger', text: errorMessage(error, t) });
    setNext(''); setConfirm('');
    setMsg({ tone: 'success', text: t('account.passwordSaved') });
  };

  if (ready === null) return <Loading />;
  if (!ready) {
    return (
      <Screen>
        <Notice tone="warning" text={t('auth.resetExpired')} />
        <Button title={t('auth.forgot')} onPress={() => router.replace('/(auth)/forgot-password')} />
      </Screen>
    );
  }
  return (
    <Screen>
      <T>{t('auth.resetChoose')}</T>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      <Input label={t('account.newPassword')} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" placeholder={t('auth.passwordRule')} />
      <Input label={t('account.confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      <Button title={t('common.save')} icon="key-outline" loading={busy} onPress={submit} />
      {msg?.tone === 'success' ? <Button title={t('common.continue')} variant="secondary" onPress={() => router.replace('/')} /> : null}
    </Screen>
  );
}
