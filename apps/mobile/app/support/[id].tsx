import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { pickImage, randomName, uploadFile, type PickedImage } from '@/lib/upload';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

interface Msg { id: string; sender_id: string; body: string; attachment_path: string | null; read_at: string | null; created_at: string; url?: string | null }

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language, colors } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = ['messages', id];

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => unwrap(await supabase.from('support_tickets').select('id, subject, status, channel, orders(id, order_number, status, payment_status)')
      .eq('id', id).single()) as unknown as { id: string; subject: string; status: string; channel: string; orders: { id: string; order_number: string; status: string; payment_status: string } | null },
  });

  const msgs = useQuery({
    queryKey: key,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('messages').select('id, sender_id, body, attachment_path, read_at, created_at').eq('ticket_id', id).order('created_at')) as Msg[];
      // Pièces jointes privées : liens signés valables 1 heure.
      const paths = rows.map((r) => r.attachment_path).filter((p): p is string => !!p);
      if (paths.length) {
        const { data } = await supabase.storage.from('chat-attachments').createSignedUrls(paths, 3600);
        const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
        rows.forEach((r) => { if (r.attachment_path) r.url = urls.get(r.attachment_path) ?? null; });
      }
      return rows;
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`ticket-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ticket_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ['messages', id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  // Marque comme lus les messages reçus.
  useEffect(() => {
    if (!session || !msgs.data) return;
    const unread = msgs.data.filter((m) => m.sender_id !== session.user.id && !m.read_at).map((m) => m.id);
    if (unread.length) supabase.from('messages').update({ read_at: new Date().toISOString() }).in('id', unread).then(() => undefined);
  }, [msgs.data, session]);

  const attach = async (source: 'camera' | 'gallery') => {
    const img = await pickImage(source);
    if (img === 'denied') return setError(t('search.cameraDenied'));
    if (img) setPhoto(img);
  };

  const send = async () => {
    if ((!body.trim() && !photo) || !session) return;
    setSending(true);
    setError(null);
    try {
      let attachment: string | null = null;
      if (photo) attachment = await uploadFile('chat-attachments', `${id}/${session.user.id}/${randomName(photo.ext)}`, photo);
      unwrap(await supabase.from('messages').insert({
        ticket_id: id, sender_id: session.user.id, body: body.trim() || t('support.photoOnly'), attachment_path: attachment,
      }));
      setBody('');
      setPhoto(null);
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  if (msgs.isLoading) return <Loading />;
  const tk = ticket.data;
  return (
    <Screen>
      {tk ? (
        <Card>
          <T weight="700">{tk.subject}</T>
          <T size="xs" muted>{t(`support.status.${tk.status}` as TranslationKey)}</T>
          {tk.orders ? (
            <Pressable onPress={() => router.push(`/order/${tk.orders!.id}`)} accessibilityRole="button">
              <T size="sm" color={colors.primary}>
                {t('support.orderRef')} : {tk.orders.order_number} · {t(`status.${tk.orders.status}` as TranslationKey)} · {t(`payStatus.${tk.orders.payment_status}` as TranslationKey)}
              </T>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {(msgs.data ?? []).map((m) => {
        const mine = m.sender_id === session?.user.id;
        return (
          <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', gap: 4, backgroundColor: mine ? colors.primary : colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
            {m.url ? <Image source={{ uri: m.url }} style={{ width: 220, height: 220, borderRadius: radius.md }} contentFit="cover" accessibilityLabel={t('support.attachment')} /> : null}
            {m.body && !(m.url && m.body === t('support.photoOnly')) ? <T color={mine ? colors.onPrimary : colors.text}>{m.body}</T> : null}
            <T size="xs" color={mine ? colors.onPrimary : colors.textMuted}>{formatDate(m.created_at, language)}{mine && m.read_at ? ' ✓✓' : ''}</T>
          </View>
        );
      })}

      {photo ? (
        <Row>
          <Image source={{ uri: photo.uri }} style={{ width: 72, height: 72, borderRadius: radius.md }} />
          <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close-circle" size={26} color={colors.danger} />
          </Pressable>
        </Row>
      ) : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      <Row style={{ alignItems: 'flex-end' }}>
        <Pressable onPress={() => attach('camera')} accessibilityRole="button" accessibilityLabel={t('common.camera')} hitSlop={6}>
          <Ionicons name="camera-outline" size={26} color={colors.primary} />
        </Pressable>
        <Pressable onPress={() => attach('gallery')} accessibilityRole="button" accessibilityLabel={t('common.attach')} hitSlop={6}>
          <Ionicons name="image-outline" size={26} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}><Input value={body} onChangeText={setBody} placeholder={t('support.message')} multiline maxLength={4000} /></View>
        <Button title={t('common.send')} loading={sending} onPress={send} />
      </Row>
    </Screen>
  );
}
