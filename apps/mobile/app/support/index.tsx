import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { TranslationKey } from '@/lib/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, EmptyState, Input, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

type Channel = 'general' | 'store' | 'driver';

export default function Support() {
  const params = useLocalSearchParams<{ orderId?: string }>();
  const { t, language, money } = useSettings();
  const [linked, setLinked] = useState<{ id: string; order_number: string; status: string; payment_status: string; total_usd: number } | null>(null);
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const orderId = linked?.id ?? params.orderId;
  const { session } = useAuth();
  const qc = useQueryClient();
  const [channel, setChannel] = useState<Channel>(params.orderId ? 'store' : 'general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const tickets = useQuery({
    queryKey: ['tickets'],
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.from('support_tickets').select('id, subject, status, channel, created_at, orders(order_number)')
        .eq('customer_id', session!.user.id).order('updated_at', { ascending: false })) as unknown as
      { id: string; subject: string; status: string; channel: Channel; created_at: string; orders: { order_number: string } | null }[],
  });

  if (!session) return <EmptyState message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;

  const runLookup = async () => {
    setLookupError(null);
    if (!lookup.trim()) return;
    const { data } = await supabase.rpc('lookup_my_order', { p_order_number: lookup.trim() });
    const found = data as typeof linked;
    if (!found?.id) { setLinked(null); return setLookupError(t('orders.lookupNotFound')); }
    setLinked(found);
    setChannel('store');
    if (!subject.trim()) setSubject(t('orders.number', { n: found.order_number }));
  };

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
      <SectionHeader title={t('support.checkOrder')} />
      <Row style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><Input value={lookup} onChangeText={setLookup} placeholder={t('orders.lookupPlaceholder')} autoCapitalize="characters" onSubmitEditing={runLookup} /></View>
        <Button title={t('common.check')} variant="secondary" icon="search-outline" onPress={runLookup} />
      </Row>
      {lookupError ? <Notice tone="warning" text={lookupError} /> : null}
      {linked ? (
        <Card onPress={() => router.push(`/order/${linked.id}`)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="700">{linked.order_number}</T>
            <T weight="700">{money(linked.total_usd)}</T>
          </Row>
          <T size="sm">{t(`status.${linked.status}` as TranslationKey)} · {t(`payStatus.${linked.payment_status}` as TranslationKey)}</T>
        </Card>
      ) : null}

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
          <T size="xs" muted>{t(`support.channel.${tk.channel}`)}{tk.orders ? ` · ${tk.orders.order_number}` : ''} · {formatDate(tk.created_at, language)} · {t(`support.status.${tk.status}` as TranslationKey)}</T>
        </Card>
      ))}
    </Screen>
  );
}
