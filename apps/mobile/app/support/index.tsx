import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, EmptyState, Input, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

type Channel = 'general' | 'store' | 'driver';

export default function Support() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const { t, language } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [channel, setChannel] = useState<Channel>(orderId ? 'store' : 'general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const tickets = useQuery({
    queryKey: ['tickets'],
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.from('support_tickets').select('id, subject, status, channel, created_at, orders(order_number)')
      .eq('customer_id', session!.user.id).order('updated_at', { ascending: false })) as
      { id: string; subject: string; status: string; channel: Channel; created_at: string; orders: { order_number: string } | null }[],
  });

  if (!session) return <EmptyState message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;

  const create = async () => {
    setError(null);
    if (!subject.trim() || !message.trim()) return setError(t('common.required'));
    if (channel !== 'general' && !orderId) return setError(t('orders.title'));
    setSending(true);
    try {
      let storeId: string | null = null;
      if (orderId) {
        const o = unwrap(await supabase.from('orders').select('store_id').eq('id', orderId).single()) as { store_id: string };
        storeId = o.store_id;
      }
      const ticket = unwrap(await supabase.from('support_tickets').insert({
        customer_id: session.user.id, order_id: orderId ?? null, store_id: storeId, channel, subject: subject.trim(),
      }).select('id').single()) as { id: string };
      unwrap(await supabase.from('messages').insert({ ticket_id: ticket.id, sender_id: session.user.id, body: message.trim() }));
      qc.invalidateQueries({ queryKey: ['tickets'] });
      router.push(`/support/${ticket.id}`);
      setSubject('');
      setMessage('');
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <SectionHeader title={t('support.new')} />
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={t('support.channel.general')} active={channel === 'general'} onPress={() => setChannel('general')} />
        {orderId ? <Chip label={t('support.channel.store')} active={channel === 'store'} onPress={() => setChannel('store')} /> : null}
        {orderId ? <Chip label={t('support.channel.driver')} active={channel === 'driver'} onPress={() => setChannel('driver')} /> : null}
      </Row>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Input label={t('support.subject')} value={subject} onChangeText={setSubject} maxLength={140} />
      <Input label={t('support.message')} value={message} onChangeText={setMessage} multiline maxLength={4000} style={{ minHeight: 100, textAlignVertical: 'top' }} />
      <Button title={t('common.send')} icon="send-outline" loading={sending} onPress={create} />

      <SectionHeader title={t('support.title')} />
      {tickets.isLoading ? <Loading /> : !tickets.data?.length ? <T muted>{t('support.empty')}</T> : tickets.data.map((tk) => (
        <Card key={tk.id} onPress={() => router.push(`/support/${tk.id}`)}>
          <T weight="700">{tk.subject}</T>
          <T size="xs" muted>{t(`support.channel.${tk.channel}`)}{tk.orders ? ` · ${tk.orders.order_number}` : ''} · {formatDate(tk.created_at, language)} · {tk.status}</T>
        </Card>
      ))}
    </Screen>
  );
}
