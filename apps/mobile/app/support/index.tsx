import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { ChatAvatar } from '@/components/ChatAvatar';
import { Button, Card, Chip, EmptyState, Input, Loading, Notice, Row, SectionHeader, T } from '@/components/ui';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useStores } from '@/hooks/data';
import { conversationSubtitle, conversationTitle, shortTime, type Channel, type ChatMessage, type Ticket } from '@/lib/chat';
import type { TranslationKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

interface Region { province: string; city: string; stores: number }
interface LinkedOrder { id: string; order_number: string; status: string; payment_status: string; total_usd: number; store_id: string; stores?: { name: string } | null }

const IN_DELIVERY = ['driver_assigned', 'driver_to_store', 'picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'];

function openDraft(p: { channel: Channel; province?: string | null; city?: string | null; storeId?: string | null; orderId?: string | null }) {
  router.push({
    pathname: '/support/[id]',
    params: { id: 'new', channel: p.channel, province: p.province ?? '', city: p.city ?? '', storeId: p.storeId ?? '', orderId: p.orderId ?? '' },
  });
}

export default function Inbox() {
  const params = useLocalSearchParams<{ orderId?: string }>();
  const { t, colors, language, money } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const stores = useStores();
  const [sheet, setSheet] = useState(!!params.orderId);
  const [pickStore, setPickStore] = useState(false);
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<LinkedOrder | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const uid = session?.user.id;

  const inbox = useQuery({
    queryKey: ['inbox'],
    enabled: !!uid,
    queryFn: async () => {
      const { data: tickets } = await supabase.from('support_tickets')
        .select('id, subject, status, channel, province, city, updated_at, created_at, store_id, order_id, stores(name), orders(id, order_number, status, payment_status)')
        .eq('customer_id', uid!).eq('is_internal', false).order('updated_at', { ascending: false });
      const list = (tickets ?? []) as unknown as Ticket[];
      const ids = list.map((x) => x.id);
      const { data: msgs } = ids.length
        ? await supabase.from('messages').select('id, ticket_id, sender_id, body, sender_label, sender_verified, attachment_path, read_at, created_at')
            .in('ticket_id', ids).order('created_at', { ascending: false }).limit(600)
        : { data: [] };
      const last = new Map<string, ChatMessage>();
      const unread = new Map<string, number>();
      for (const m of (msgs ?? []) as ChatMessage[]) {
        if (!last.has(m.ticket_id)) last.set(m.ticket_id, m);
        if (m.sender_id !== uid && !m.read_at) unread.set(m.ticket_id, (unread.get(m.ticket_id) ?? 0) + 1);
      }
      return list.map((x) => ({ ticket: x, last: last.get(x.id) ?? null, unread: unread.get(x.id) ?? 0 }));
    },
  });

  const regions = useQuery({
    queryKey: ['assistant-regions'],
    enabled: !!uid,
    queryFn: async () => ((await supabase.rpc('assistant_regions')).data ?? []) as Region[],
  });
  const home = useQuery({
    queryKey: ['home-region'],
    enabled: !!uid,
    queryFn: async () => {
      const { data } = await supabase.from('addresses').select('province, city').eq('user_id', uid!)
        .order('is_default', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return (data as { province: string; city: string } | null) ?? null;
    },
  });
  const linked = useQuery({
    queryKey: ['support-order', params.orderId],
    enabled: !!params.orderId,
    queryFn: async () => (await supabase.from('orders').select('id, order_number, status, payment_status, total_usd, store_id, stores(name)')
      .eq('id', params.orderId!).maybeSingle()).data as unknown as LinkedOrder | null,
  });

  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel('inbox-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => qc.invalidateQueries({ queryKey: ['inbox'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);

  // Ma ville en premier, puis les autres villes où un ASSISTANT répond.
  const regionList = useMemo(() => {
    const all = regions.data ?? [];
    const mine = home.data?.city?.toLowerCase();
    return [...all].sort((a, b) => Number(b.city.toLowerCase() === mine) - Number(a.city.toLowerCase() === mine));
  }, [regions.data, home.data]);

  if (!session) return <EmptyState icon="chatbubbles-outline" message={t('auth.required')} action={t('auth.signIn')} onAction={() => router.push('/(auth)/sign-in')} />;

  const runLookup = async () => {
    setLookupError(null);
    setFound(null);
    if (!lookup.trim()) return;
    const { data } = await supabase.rpc('lookup_my_order', { p_order_number: lookup.trim() });
    const o = data as LinkedOrder | null;
    if (!o?.id) return setLookupError(t('orders.lookupNotFound'));
    setFound(o);
  };

  const order = linked.data;
  const header = (
    <View style={{ gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.sm }}>
      <Pressable onPress={() => setSheet(true)} accessibilityRole="button" style={[styles.newChat, { backgroundColor: colors.primary }]}>
        <View style={styles.newChatIcon}><Ionicons name="create-outline" size={22} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <T weight="800" color={colors.onPrimary}>{t('inbox.newChat')}</T>
          <T size="xs" color={colors.onPrimary}>{t('inbox.newChatHint')}</T>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.onPrimary} />
      </Pressable>

      <Card>
        <Row gap={8}><Ionicons name="receipt-outline" size={18} color={colors.primary} /><T weight="700">{t('support.checkOrder')}</T></Row>
        <Row style={{ alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Input value={lookup} onChangeText={setLookup} placeholder={t('orders.lookupPlaceholder')} autoCapitalize="characters" onSubmitEditing={runLookup} /></View>
          <Button title={t('common.check')} variant="secondary" icon="search-outline" onPress={runLookup} />
        </Row>
        {lookupError ? <Notice tone="warning" text={lookupError} /> : null}
        {found ? (
          <Pressable onPress={() => router.push(`/order/${found.id}`)} style={[styles.found, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <T weight="700">{found.order_number}</T>
              <T size="sm">{t(`status.${found.status}` as TranslationKey)} · {t(`payStatus.${found.payment_status}` as TranslationKey)}</T>
            </View>
            <T weight="700">{money(found.total_usd)}</T>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
        {found ? <Button title={t('inbox.askAboutOrder')} icon="chatbubble-ellipses-outline" variant="ghost"
          onPress={() => openDraft({ channel: 'store', storeId: found.store_id, orderId: found.id })} /> : null}
      </Card>

      {(inbox.data?.length ?? 0) > 0 ? <SectionHeader title={t('inbox.conversations')} /> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['left', 'right']}>
      {inbox.isLoading ? <Loading /> : (
        <FlatList
          data={inbox.data ?? []}
          keyExtractor={(x) => x.ticket.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" message={t('inbox.empty')} />}
          ListFooterComponent={<AppFooter />}
          onRefresh={() => inbox.refetch()}
          refreshing={inbox.isRefetching}
          renderItem={({ item: { ticket, last, unread } }) => {
            const title = conversationTitle({ channel: ticket.channel, city: ticket.city, province: ticket.province, storeName: ticket.stores?.name });
            const mine = last?.sender_id === uid;
            const preview = last ? (last.attachment_path && (!last.body || last.body === t('support.photoOnly')) ? t('support.photoOnly') : last.body) : t('inbox.noMessageYet');
            return (
              <Pressable onPress={() => router.push(`/support/${ticket.id}`)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}>
                <ChatAvatar size={52} />
                <View style={[styles.rowBody, { borderBottomColor: colors.border }]}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row gap={4} style={{ flex: 1 }}>
                      <T weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</T>
                      <VerifiedBadge size={15} />
                    </Row>
                    <T size="xs" color={unread ? colors.primary : colors.textMuted} weight={unread ? '700' : '400'}>
                      {shortTime(last?.created_at ?? ticket.updated_at, language, t)}
                    </T>
                  </Row>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T size="sm" muted numberOfLines={1} style={{ flex: 1 }}>
                      {mine ? <T size="sm" color={last?.read_at ? colors.accent : colors.textMuted}>{last?.read_at ? '✓✓ ' : '✓ '}</T> : null}
                      {preview}
                    </T>
                    {unread ? (
                      <View style={[styles.unread, { backgroundColor: colors.primary }]}><T size="xs" weight="800" color={colors.onPrimary}>{unread}</T></View>
                    ) : null}
                  </Row>
                  <Row gap={6}>
                    <T size="xs" muted numberOfLines={1}>{conversationSubtitle(ticket.channel, t)}</T>
                    {ticket.orders ? <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}><T size="xs" weight="600">{ticket.orders.order_number}</T></View> : null}
                    {ticket.status === 'resolved' || ticket.status === 'closed' ? (
                      <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}><T size="xs" muted>{t(`support.status.${ticket.status}` as TranslationKey)}</T></View>
                    ) : null}
                  </Row>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <ScrollView contentContainerStyle={{ gap: spacing.md, padding: spacing.lg }}>
            <T size="lg" weight="800">{t('inbox.newChat')}</T>
            <T size="sm" muted>{t('inbox.chooseAssistant')}</T>

            {order ? (
              <Card onPress={() => { setSheet(false); openDraft({ channel: 'store', storeId: order.store_id, orderId: order.id }); }}>
                <Row gap={12}>
                  <ChatAvatar size={44} />
                  <View style={{ flex: 1 }}>
                    <Row gap={4}><T weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{conversationTitle({ channel: 'store', storeName: order.stores?.name })}</T><VerifiedBadge size={14} /></Row>
                    <T size="xs" muted>{t('inbox.aboutOrder', { n: order.order_number })}</T>
                  </View>
                </Row>
              </Card>
            ) : null}
            {order && IN_DELIVERY.includes(order.status) ? (
              <Card onPress={() => { setSheet(false); openDraft({ channel: 'driver', storeId: order.store_id, orderId: order.id }); }}>
                <Row gap={12}>
                  <View style={[styles.driverIcon, { backgroundColor: colors.primarySoft }]}><Ionicons name="bicycle" size={22} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <T weight="800">{conversationTitle({ channel: 'driver' })}</T>
                    <T size="xs" muted>{t('inbox.driverChannel')}</T>
                  </View>
                </Row>
              </Card>
            ) : null}

            <T size="sm" weight="700">{t('inbox.byCity')}</T>
            {regionList.map((r) => (
              <Card key={`${r.province}-${r.city}`} onPress={() => { setSheet(false); openDraft({ channel: 'general', province: r.province, city: r.city, orderId: order?.id }); }}>
                <Row gap={12}>
                  <ChatAvatar size={44} />
                  <View style={{ flex: 1 }}>
                    <Row gap={4}><T weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{conversationTitle({ channel: 'general', city: r.city, province: r.province })}</T><VerifiedBadge size={14} /></Row>
                    <T size="xs" muted>{r.province}{r.stores ? ` · ${t('inbox.storesCount', { n: r.stores })}` : ''}</T>
                  </View>
                  {home.data?.city?.toLowerCase() === r.city.toLowerCase() ? <Chip label={t('inbox.myCity')} active /> : null}
                </Row>
              </Card>
            ))}

            <Pressable onPress={() => setPickStore((v) => !v)} style={[styles.toggle, { borderColor: colors.border }]}>
              <Ionicons name="storefront-outline" size={20} color={colors.primary} />
              <T weight="700" style={{ flex: 1 }}>{t('inbox.byStore')}</T>
              <Ionicons name={pickStore ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Pressable>
            {pickStore ? (stores.data ?? []).map((s) => (
              <Card key={s.id} onPress={() => { setSheet(false); openDraft({ channel: 'store', storeId: s.id, orderId: order?.store_id === s.id ? order.id : null }); }}>
                <Row gap={12}>
                  <ChatAvatar size={40} />
                  <View style={{ flex: 1 }}>
                    <Row gap={4}><T weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>{conversationTitle({ channel: 'store', storeName: s.name })}</T><VerifiedBadge size={13} /></Row>
                    <T size="xs" muted>{[s.commune, s.city].filter(Boolean).join(', ')}</T>
                  </View>
                </Row>
              </Card>
            )) : null}
            <Button title={t('common.close')} variant="ghost" onPress={() => setSheet(false)} />
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  newChat: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md },
  newChatIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  found: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg },
  rowBody: { flex: 1, gap: 3, paddingVertical: spacing.md, paddingRight: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  unread: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  tag: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '82%', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: spacing.sm },
  grabber: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  driverIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
