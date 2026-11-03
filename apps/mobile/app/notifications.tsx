import { router } from 'expo-router';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, EmptyState, Loading, Screen, T } from '@/components/ui';
import { qk, useNotifications } from '@/hooks/data';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function Notifications() {
  const { t, language, colors } = useSettings();
  const { session } = useAuth();
  const q = useNotifications();
  const qc = useQueryClient();

  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel('my-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` },
        () => qc.invalidateQueries({ queryKey: qk.notifications }))
      .subscribe();
    // Tout marquer comme lu à l'ouverture.
    supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).eq('user_id', session.user.id).then(() => undefined);
    return () => { supabase.removeChannel(ch); };
  }, [session, qc]);

  if (!session) return <EmptyState message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <EmptyState icon="notifications-off-outline" message={t('notifications.empty')} />;
  return (
    <Screen>
      {q.data.map((n) => {
        const orderId = typeof n.data?.order_id === 'string' ? n.data.order_id : null;
        const ticketId = typeof n.data?.ticket_id === 'string' ? n.data.ticket_id : null;
        const loyalty = n.kind === 'loyalty' || n.data?.screen === 'loyalty';
        const open = loyalty ? () => router.push('/loyalty')
          : ticketId ? () => router.push(`/support/${ticketId}`) : orderId ? () => router.push(`/order/${orderId}`) : undefined;
        return (
          <Card key={n.id} onPress={open}
            style={!n.read_at ? { borderLeftWidth: 4, borderLeftColor: colors.primary } : undefined}>
            <T weight="700">{n.title}</T>
            {n.body ? <T size="sm">{n.body}</T> : null}
            <T size="xs" muted>{formatDate(n.created_at, language)}</T>
          </Card>
        );
      })}
    </Screen>
  );
}
