import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Notice, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function DeleteAccount() {
  const { t, colors } = useSettings();
  const { session, signOut } = useAuth();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return <Redirect href="/(auth)/sign-in" />;

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const { error: fnError } = await supabase.functions.invoke('delete-account', { body: { confirm: 'SUPPRIMER' } });
      if (fnError) {
        let code = '';
        try { code = ((await (fnError as { context?: Response }).context?.json()) as { error?: string })?.error ?? ''; } catch { /* corps illisible */ }
        if (code === 'ACTIVE_ORDERS') return setError(t('account.deleteActiveOrders'));
        if (code === 'STAFF_ACCOUNT') return setError(t('account.deleteStaff'));
        throw fnError;
      }
      await signOut();
      qc.clear();
      Alert.alert(t('account.deleteAccount'), t('account.deleteDone'));
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ borderColor: colors.danger, borderWidth: 1 }}>
        <T weight="700" color={colors.danger}>{t('account.deleteAccount')}</T>
        <T>{t('account.deleteWarn')}</T>
      </Card>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Input label={t('account.deleteType')} value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
      <Button title={t('account.deleteAccount')} variant="danger" icon="trash-outline" loading={busy}
        disabled={confirm.trim().toUpperCase() !== 'SUPPRIMER'} onPress={run} />
    </Screen>
  );
}
