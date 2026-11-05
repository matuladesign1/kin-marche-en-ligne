import * as Notifications from 'expo-notifications';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, Switch, View } from 'react-native';
import { ListGroup, ListRow } from '@/components/kit';
import { Button, Notice, T } from '@/components/ui';
import { ensurePermission, isPushActive, presentLocal } from '@/lib/notify';
import { supabase } from '@/lib/supabase';
import { spacing } from '@/lib/theme';
import type { NotificationCategory } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const CATEGORIES: { key: NotificationCategory; icon: 'receipt-outline' | 'gift-outline' | 'chatbubbles-outline' | 'pricetags-outline' }[] = [
  { key: 'orders', icon: 'receipt-outline' },
  { key: 'rewards', icon: 'gift-outline' },
  { key: 'messages', icon: 'chatbubbles-outline' },
  { key: 'promos', icon: 'pricetags-outline' },
];

/** Réglages des notifications : autorisation du téléphone et catégories reçues. */
export default function NotificationSettings() {
  const { t, colors } = useSettings();
  const { session, profile, refreshProfile } = useAuth();
  const [status, setStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null);
  const [prefs, setPrefs] = useState<Partial<Record<NotificationCategory, boolean>>>(profile?.notification_prefs ?? {});
  const [saving, setSaving] = useState(false);

  const readStatus = useCallback(async () => {
    if (Platform.OS === 'web') return setStatus('denied');
    const p = await Notifications.getPermissionsAsync();
    setStatus(p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied');
  }, []);

  useEffect(() => {
    readStatus();
    // Retour depuis les réglages du téléphone : on relit l'autorisation.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') readStatus(); });
    return () => sub.remove();
  }, [readStatus]);

  useEffect(() => { setPrefs(profile?.notification_prefs ?? {}); }, [profile?.notification_prefs]);

  if (!session) return <Redirect href="/(auth)/sign-in" />;

  const toggle = async (key: NotificationCategory, on: boolean) => {
    const next = { ...prefs, [key]: on };
    setPrefs(next);
    setSaving(true);
    await supabase.from('profiles').update({ notification_prefs: next }).eq('id', session.user.id);
    await refreshProfile();
    setSaving(false);
  };

  const allow = async () => {
    if (status === 'denied') return Linking.openSettings();
    await ensurePermission(true);
    readStatus();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingVertical: spacing.md, gap: spacing.lg }}>
      <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
        {status === 'granted' ? (
          <Notice tone="success" text={t('notifSettings.allowed')} />
        ) : status ? (
          <>
            <Notice tone="warning" text={status === 'denied' ? t('notifSettings.blocked') : t('notifSettings.ask')} />
            <Button title={status === 'denied' ? t('notifSettings.openSettings') : t('notifSettings.allow')} icon="notifications-outline" onPress={allow} />
          </>
        ) : null}
      </View>

      <ListGroup title={t('notifSettings.receive')} footer={t('notifSettings.always')}>
        {CATEGORIES.map((c) => (
          <ListRow key={c.key} icon={c.icon} label={t(`notifSettings.cat.${c.key}`)} subtitle={t(`notifSettings.catText.${c.key}`)}
            right={<Switch value={prefs[c.key] !== false} disabled={saving} onValueChange={(v) => toggle(c.key, v)}
              trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#FFFFFF" />} />
        ))}
      </ListGroup>

      {status === 'granted' ? (
        <ListGroup>
          <ListRow label={t('notifSettings.test')} icon="paper-plane-outline" onPress={() => presentLocal({
            title: t('notifSettings.testTitle'), body: t('notifSettings.testBody'), channel: 'general',
          })} />
        </ListGroup>
      ) : null}

      {!isPushActive() && Platform.OS !== 'web' ? (
        <T size="xs" muted style={{ paddingHorizontal: spacing.lg }}>{t('notifSettings.liveOnly')}</T>
      ) : null}
    </ScrollView>
  );
}
