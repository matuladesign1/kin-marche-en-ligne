import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Loading, Row, Screen, T } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language, colors } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const key = ['messages', id];
  const msgs = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await supabase.from('messages').select('id, sender_id, body, created_at').eq('ticket_id', id).order('created_at')) as
      { id: string; sender_id: string; body: string; created_at: string }[],
  });

  useEffect(() => {
    const ch = supabase.channel(`ticket-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['messages', id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  const send = async () => {
    if (!body.trim() || !session) return;
    await supabase.from('messages').insert({ ticket_id: id, sender_id: session.user.id, body: body.trim() });
    setBody('');
    qc.invalidateQueries({ queryKey: key });
  };

  if (msgs.isLoading) return <Loading />;
  return (
    <Screen>
      {(msgs.data ?? []).map((m) => {
        const mine = m.sender_id === session?.user.id;
        return (
          <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: mine ? colors.primary : colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
            <T color={mine ? colors.onPrimary : colors.text}>{m.body}</T>
            <T size="xs" color={mine ? colors.onPrimary : colors.textMuted}>{formatDate(m.created_at, language)}</T>
          </View>
        );
      })}
      <Row style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><Input value={body} onChangeText={setBody} placeholder={t('support.message')} multiline maxLength={4000} /></View>
        <Button title={t('common.send')} onPress={send} />
      </Row>
    </Screen>
  );
}
