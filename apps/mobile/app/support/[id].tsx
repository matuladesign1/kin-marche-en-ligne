import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatAvatar } from '@/components/ChatAvatar';
import { Button, Input, Notice, Row, T } from '@/components/ui';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { conversationSubtitle, conversationTitle, dayLabel, type Channel, type ChatMessage, type Ticket } from '@/lib/chat';
import { errorMessage } from '@/lib/errors';
import { setOpenChat } from '@/lib/notify';
import type { TranslationKey } from '@/lib/i18n';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { pickImage, randomName, uploadFile, type PickedImage } from '@/lib/upload';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

type Row_ = { kind: 'day'; id: string; label: string } | { kind: 'msg'; id: string; m: ChatMessage; first: boolean };
interface OrderInfo { id: string; order_number: string; status: string; payment_status: string; total_usd: number; store_id: string }

export default function Chat() {
  const p = useLocalSearchParams<{ id: string; channel?: string; province?: string; city?: string; storeId?: string; orderId?: string }>();
  const { t, language, colors, money, isDark } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [ticketId, setTicketId] = useState<string | null>(p.id === 'new' ? null : p.id);
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<OrderInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const uid = session?.user.id;
  // Conversation à l'écran : ses nouveaux messages ne déclenchent pas d'alerte sur le téléphone.
  useFocusEffect(useCallback(() => {
    setOpenChat(ticketId);
    return () => setOpenChat(null);
  }, [ticketId]));
  const dark = isDark;
  const chatBg = dark ? '#0E1116' : '#F5EFEB';
  const mineBg = dark ? '#5B1D1A' : '#FDDCD9';
  const theirsBg = dark ? colors.surface : '#FFFFFF';

  const draftStore = useQuery({
    queryKey: ['chat-draft-store', p.storeId],
    enabled: !ticketId && !!p.storeId,
    queryFn: async () => (await supabase.from('stores').select('name').eq('id', p.storeId!).maybeSingle()).data as { name: string } | null,
  });

  const ticket = useQuery({
    queryKey: ['ticket', ticketId],
    enabled: !!ticketId,
    queryFn: async () => unwrap(await supabase.from('support_tickets')
      .select('id, subject, status, channel, province, city, updated_at, created_at, store_id, order_id, stores(name), orders(id, order_number, status, payment_status)')
      .eq('id', ticketId!).single()) as unknown as Ticket,
  });

  const msgs = useQuery({
    queryKey: ['messages', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('messages')
        .select('id, ticket_id, sender_id, body, sender_label, sender_verified, attachment_path, read_at, created_at')
        .eq('ticket_id', ticketId!).order('created_at')) as ChatMessage[];
      // Pièces jointes privées : liens signés valables 1 heure.
      const paths = rows.map((r) => r.attachment_path).filter((x): x is string => !!x);
      if (paths.length) {
        const { data } = await supabase.storage.from('chat-attachments').createSignedUrls(paths, 3600);
        const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
        rows.forEach((r) => { if (r.attachment_path) r.url = urls.get(r.attachment_path) ?? null; });
      }
      return rows;
    },
  });

  useEffect(() => {
    if (!ticketId) return;
    const ch = supabase.channel(`ticket-${ticketId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `ticket_id=eq.${ticketId}` },
        () => qc.invalidateQueries({ queryKey: ['messages', ticketId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ticketId, qc]);

  // Marque comme lus les messages reçus.
  useEffect(() => {
    if (!uid || !msgs.data) return;
    const unread = msgs.data.filter((m) => m.sender_id !== uid && !m.read_at).map((m) => m.id);
    if (unread.length) {
      supabase.from('messages').update({ read_at: new Date().toISOString() }).in('id', unread)
        .then(() => { qc.invalidateQueries({ queryKey: ['inbox'] }); qc.invalidateQueries({ queryKey: ['unread-messages'] }); });
    }
  }, [msgs.data, uid, qc]);

  const channel = (ticket.data?.channel ?? p.channel ?? 'general') as Channel;
  const title = conversationTitle({
    channel,
    city: ticket.data?.city ?? (p.city || null),
    province: ticket.data?.province ?? (p.province || null),
    storeName: ticket.data?.stores?.name ?? draftStore.data?.name ?? null,
  });

  // Liste inversée (dernier message en bas) avec séparateurs de date.
  const rows = useMemo<Row_[]>(() => {
    const out: Row_[] = [];
    let lastDay = '';
    let lastSender = '';
    for (const m of msgs.data ?? []) {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) { out.push({ kind: 'day', id: `d-${day}`, label: dayLabel(m.created_at, language, t) }); lastDay = day; lastSender = ''; }
      out.push({ kind: 'msg', id: m.id, m, first: m.sender_id !== lastSender });
      lastSender = m.sender_id;
    }
    return out.reverse();
  }, [msgs.data, language, t]);

  const attach = async (source: 'camera' | 'gallery') => {
    const img = await pickImage(source);
    if (img === 'denied') return setError(t('search.cameraDenied'));
    if (img) setPhoto(img);
  };

  const ensureTicket = async (): Promise<string> => {
    if (ticketId) return ticketId;
    let storeId: string | null = p.storeId || null;
    if (!storeId && p.orderId) {
      const o = unwrap(await supabase.from('orders').select('store_id').eq('id', p.orderId).single()) as { store_id: string };
      storeId = o.store_id;
    }
    const created = unwrap(await supabase.from('support_tickets').insert({
      customer_id: uid, channel, subject: title, status: 'open',
      store_id: channel === 'general' ? null : storeId, order_id: p.orderId || null,
      province: channel === 'general' ? p.province || null : null, city: channel === 'general' ? p.city || null : null,
    }).select('id').single()) as { id: string };
    setTicketId(created.id);
    router.setParams({ id: created.id });
    qc.invalidateQueries({ queryKey: ['inbox'] });
    return created.id;
  };

  const send = async (text?: string) => {
    const content = (text ?? body).trim();
    if ((!content && !photo) || !uid) return;
    setSending(true);
    setError(null);
    try {
      const id = await ensureTicket();
      let attachment: string | null = null;
      if (photo && !text) attachment = await uploadFile('chat-attachments', `${id}/${uid}/${randomName(photo.ext)}`, photo);
      unwrap(await supabase.from('messages').insert({
        ticket_id: id, sender_id: uid, body: content || t('support.photoOnly'), attachment_path: attachment,
      }));
      if (!text) { setBody(''); setPhoto(null); }
      qc.invalidateQueries({ queryKey: ['messages', id] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  const runLookup = async () => {
    setLookupError(null);
    setFound(null);
    if (!lookup.trim()) return;
    const { data } = await supabase.rpc('lookup_my_order', { p_order_number: lookup.trim() });
    const o = data as OrderInfo | null;
    if (!o?.id) return setLookupError(t('orders.lookupNotFound'));
    setFound(o);
  };

  const order = ticket.data?.orders;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: chatBg }} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Row gap={10}>
              <ChatAvatar size={36} badge={false} />
              <View style={{ maxWidth: 220 }}>
                <Row gap={4}>
                  <T weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</T>
                  <VerifiedBadge size={15} />
                </Row>
                <T size="xs" muted numberOfLines={1}>{conversationSubtitle(channel, t)}</T>
              </View>
            </Row>
          ),
          headerRight: () => (
            <Pressable onPress={() => setLookupOpen(true)} hitSlop={10} accessibilityLabel={t('support.checkOrder')}>
              <Ionicons name="receipt-outline" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {order ? (
          <Pressable onPress={() => router.push(`/order/${order.id}`)} style={[styles.pinned, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Ionicons name="cube-outline" size={18} color={colors.primary} />
            <T size="sm" weight="700">{order.order_number}</T>
            <T size="sm" muted numberOfLines={1} style={{ flex: 1 }}>{t(`status.${order.status}` as TranslationKey)}</T>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}

        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.md, gap: 4 }}
          ListFooterComponent={
            <View style={[styles.intro, { backgroundColor: dark ? colors.surface : '#FFF8E6' }]}>
              <Ionicons name="shield-checkmark" size={16} color={colors.warning} />
              <T size="xs" style={{ flex: 1, textAlign: 'center' }}>{t('inbox.securityNote')}</T>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'day') {
              return (
                <View style={[styles.day, { backgroundColor: dark ? colors.surfaceAlt : '#FFFFFF' }]}>
                  <T size="xs" weight="600" muted>{item.label}</T>
                </View>
              );
            }
            const m = item.m;
            const mine = m.sender_id === uid;
            const time = new Date(m.created_at).toLocaleTimeString(language === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
            const onlyPhoto = !!m.url && m.body === t('support.photoOnly');
            return (
              <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: item.first ? 6 : 0 }}>
                <View style={[
                  styles.bubble,
                  { backgroundColor: mine ? mineBg : theirsBg },
                  item.first ? (mine ? { borderTopRightRadius: 4 } : { borderTopLeftRadius: 4 }) : null,
                ]}>
                  {!mine && item.first && m.sender_label ? (
                    <Row gap={4}>
                      <T size="xs" weight="800" color={colors.primary}>{m.sender_label}</T>
                      {m.sender_verified ? <VerifiedBadge size={12} /> : null}
                    </Row>
                  ) : null}
                  {m.url ? (
                    <Pressable onPress={() => setViewer(m.url!)}>
                      <Image source={{ uri: m.url }} style={styles.photo} contentFit="cover" accessibilityLabel={t('support.attachment')} />
                    </Pressable>
                  ) : null}
                  {!onlyPhoto ? <T style={{ lineHeight: 21 }}>{m.body}</T> : null}
                  <Row gap={3} style={{ alignSelf: 'flex-end' }}>
                    <T size="xs" muted>{time}</T>
                    {mine ? <Ionicons name={m.read_at ? 'checkmark-done' : 'checkmark'} size={15} color={m.read_at ? colors.accent : colors.textMuted} /> : null}
                  </Row>
                </View>
              </View>
            );
          }}
        />

        {photo ? (
          <Row style={[styles.preview, { backgroundColor: colors.surface }]}>
            <Image source={{ uri: photo.uri }} style={{ width: 64, height: 64, borderRadius: radius.md }} />
            <T size="sm" muted style={{ flex: 1 }}>{t('support.attachment')}</T>
            <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
              <Ionicons name="close-circle" size={26} color={colors.danger} />
            </Pressable>
          </Row>
        ) : null}
        {error ? <View style={{ paddingHorizontal: spacing.md }}><Notice tone="danger" text={error} /></View> : null}

        <View style={styles.composer}>
          <View style={[styles.inputWrap, { backgroundColor: colors.surface }]}>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={t('inbox.typeMessage')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={4000}
              style={[styles.input, { color: colors.text }]}
            />
            <Pressable onPress={() => attach('gallery')} hitSlop={8} accessibilityLabel={t('common.attach')}>
              <Ionicons name="attach" size={24} color={colors.textMuted} />
            </Pressable>
            <Pressable onPress={() => attach('camera')} hitSlop={8} accessibilityLabel={t('common.camera')}>
              <Ionicons name="camera" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => send()}
            disabled={sending || (!body.trim() && !photo)}
            accessibilityRole="button"
            accessibilityLabel={t('common.send')}
            style={[styles.send, { backgroundColor: colors.primary, opacity: sending || (!body.trim() && !photo) ? 0.6 : 1 }]}
          >
            <Ionicons name={sending ? 'hourglass-outline' : 'send'} size={20} color={colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>

      <Modal visible={lookupOpen} transparent animationType="slide" onRequestClose={() => setLookupOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setLookupOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <T size="lg" weight="800">{t('support.checkOrder')}</T>
          <Input value={lookup} onChangeText={setLookup} placeholder={t('orders.lookupPlaceholder')} autoCapitalize="characters" onSubmitEditing={runLookup} />
          <Button title={t('common.check')} icon="search-outline" variant="secondary" onPress={runLookup} />
          {lookupError ? <Notice tone="warning" text={lookupError} /> : null}
          {found ? (
            <View style={[styles.found, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T weight="800">{found.order_number}</T>
                <T weight="800">{money(found.total_usd)}</T>
              </Row>
              <T size="sm">{t(`status.${found.status}` as TranslationKey)} · {t(`payStatus.${found.payment_status}` as TranslationKey)}</T>
              <Row>
                <Button style={{ flex: 1 }} title={t('inbox.shareOrder')} icon="share-outline"
                  onPress={() => {
                    setLookupOpen(false);
                    send(t('inbox.orderMessage', {
                      n: found.order_number,
                      status: t(`status.${found.status}` as TranslationKey),
                      pay: t(`payStatus.${found.payment_status}` as TranslationKey),
                    }));
                  }} />
                <Button title={t('common.open')} variant="ghost" onPress={() => { setLookupOpen(false); router.push(`/order/${found.id}`); }} />
              </Row>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pinned: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md, maxWidth: '92%' },
  day: { alignSelf: 'center', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 4, marginVertical: spacing.sm },
  bubble: {
    maxWidth: '82%', borderRadius: 14, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, gap: 2,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  photo: { width: 230, height: 230, borderRadius: 10, marginVertical: 2 },
  preview: { marginHorizontal: spacing.md, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 24, paddingHorizontal: spacing.md, minHeight: 48 },
  input: { flex: 1, fontSize: 16, maxHeight: 120, paddingVertical: Platform.OS === 'ios' ? 12 : 8 },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, gap: spacing.md },
  found: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
