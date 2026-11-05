import * as Application from 'expo-application';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { Stars } from '@/components/Stars';
import { Button, Card, Input, Notice, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function RateApp() {
  const { t } = useSettings();
  const { session } = useAuth();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [sent, setSent] = useState(false);

  if (!session) return <Redirect href="/(auth)/sign-in" />;
  const pkg = Application.applicationId ?? 'cd.kinmarche.enligne';

  const submit = async () => {
    if (!rating) return setMsg({ tone: 'danger', text: t('review.needOne') });
    setBusy(true);
    setMsg(null);
    try {
      unwrap(await supabase.from('app_feedback').insert({
        user_id: session.user.id, rating, comment: comment.trim() || null,
        app_version: Application.nativeApplicationVersion ?? null, platform: Platform.OS,
      }));
      setSent(true);
      setMsg({ tone: 'success', text: t('account.rateThanks') });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        <T weight="700" size="lg">{t('account.rateApp')}</T>
        <T muted size="sm" style={{ textAlign: 'center' }}>{t('account.rateHelp')}</T>
        <Stars value={rating} onChange={sent ? () => undefined : setRating} />
      </Card>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      {!sent ? (
        <>
          <Input label={t('account.rateComment')} value={comment} onChangeText={setComment} multiline maxLength={2000} style={{ minHeight: 90, textAlignVertical: 'top' }} />
          <Button title={t('common.send')} icon="send-outline" loading={busy} onPress={submit} />
        </>
      ) : Platform.OS === 'android' ? (
        <Button title={t('account.rateStore')} variant="secondary" icon="logo-google-playstore"
          onPress={() => Linking.openURL(`market://details?id=${pkg}`).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${pkg}`))} />
      ) : null}
    </Screen>
  );
}
