import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Loading, Notice, Row, T } from '@/components/ui';
import { usePastryMessages, usePastryOrder } from '@/hooks/pastry';
import { dayLabel } from '@/lib/chat';
import { errorMessage } from '@/lib/errors';
import { setOpenChat } from '@/lib/notify';
import { PASTRY } from '@/lib/pastry';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import type { PastryMessage } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

type ChatRow = { kind: 'day'; id: string; label: string } | { kind: 'msg'; id: string; m: PastryMessage; first: boolean };

// Discussion d'une commande pâtisserie entre le client et la pâtisserie du supermarché (pâtissiers et direction).
export default function PastryChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, colors, language, isDark } = useSettings();
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const order = usePastryOrder(id);
  const messages = usePastryMessages(id);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pas d'alerte « nouveau message » tant que cette discussion est ouverte.
  useFocusEffect(useCallback(() => {
    setOpenChat(`pastry:${id}`);
    return () => setOpenChat(null);
  }, [id]));

  const o = order.data;
  const iAmCustomer = !!o && o.customer_id === uid;
  const chatBg = isDark ? '#120D0B' : '#F8F1EA';
  const mineBg = isDark ? '#4A1F2E' : '#FBDDE8';
  const theirsBg = isDark ? colors.surface : '#FFFFFF';

  const rows = useMemo<ChatRow[]>(() => {
    const out: ChatRow[] = [];
    let lastDay = '';
    let lastSender = '';
    for (const m of messages.data ?? []) {
      const d = new Date(m.created_at).toDateString();
      if (d !== lastDay) {
        out.push({ kind: 'day', id: `d-${d}`, label: dayLabel(m.created_at, language, t) });
        lastDay = d;
        lastSender = '';
      }
      out.push({ kind: 'msg', id: m.id, m, first: m.sender_id !== lastSender });
      lastSender = m.sender_id;
    }
    return out.reverse();
  }, [messages.data, language, t]);

  if (order.isLoading || messages.isLoading) return <Loading />;
  if (!o) return null;

  const send = async () => {
    const text = body.trim();
    if (!text || !uid) return;
    setSending(true);
    setError(null);
    try {
      unwrap(await supabase.from('pastry_messages').insert({ cake_order_id: o.id, sender_id: uid, body: text }));
      setBody('');
      qc.invalidateQueries({ queryKey: ['pastry', 'messages', o.id] });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  const title = iAmCustomer ? (o.stores?.name ?? t('pastry.title')) : o.full_name;
  const labelFor = (m: PastryMessage) => {
    if (m.sender_id === o.customer_id) return t('pastry.customerLabel');
    return t('pastry.title');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: chatBg }} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Row gap={10}>
              <View style={[styles.avatar, { backgroundColor: PASTRY.choco }]}>
                <MaterialCommunityIcons name={iAmCustomer ? 'chef-hat' : 'account'} size={20} color="#FFFFFF" />
              </View>
              <View style={{ maxWidth: 220 }}>
                <T weight="800" numberOfLines={1}>{title}</T>
                <T size="xs" muted numberOfLines={1}>{o.request_number ?? ''} · {o.cake_type}</T>
              </View>
            </Row>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <Pressable onPress={() => router.back()} style={[styles.pinned, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <MaterialCommunityIcons name="cake-variant" size={18} color={PASTRY.raspberry} />
          <T size="sm" weight="700">{o.request_number}</T>
          <T size="sm" muted numberOfLines={1} style={{ flex: 1 }}>{t(`pastry.status.${o.status}` as 'pastry.status.paid')}</T>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.md, gap: 4 }}
          ListFooterComponent={
            <View style={[styles.intro, { backgroundColor: isDark ? colors.surface : '#FFF8E6' }]}>
              <Ionicons name="shield-checkmark" size={16} color={colors.warning} />
              <T size="xs" style={{ flex: 1, textAlign: 'center' }}>{iAmCustomer ? t('pastry.chatIntro') : t('pastry.chatIntroChef')}</T>
            </View>
          }
          ListEmptyComponent={<T size="sm" muted style={{ textAlign: 'center', marginTop: spacing.lg }}>{t('pastry.chatEmpty')}</T>}
          renderItem={({ item }) => {
            if (item.kind === 'day') {
              return (
                <View style={[styles.day, { backgroundColor: isDark ? colors.surfaceAlt : '#FFFFFF' }]}>
                  <T size="xs" weight="600" muted>{item.label}</T>
                </View>
              );
            }
            const m = item.m;
            const mine = m.sender_id === uid;
            const time = new Date(m.created_at).toLocaleTimeString(language === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
            return (
              <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: item.first ? 6 : 0 }}>
                <View style={[styles.bubble, { backgroundColor: mine ? mineBg : theirsBg },
                  item.first ? (mine ? { borderTopRightRadius: 4 } : { borderTopLeftRadius: 4 }) : null]}>
                  {!mine && item.first ? <T size="xs" weight="800" color={PASTRY.raspberryDeep}>{labelFor(m)}</T> : null}
                  <T style={{ lineHeight: 21 }}>{m.body}</T>
                  <T size="xs" muted style={{ alignSelf: 'flex-end' }}>{time}</T>
                </View>
              </View>
            );
          }}
        />

        {error ? <View style={{ paddingHorizontal: spacing.md }}><Notice tone="danger" text={error} /></View> : null}
        <View style={styles.composer}>
          <View style={[styles.inputWrap, { backgroundColor: colors.surface }]}>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={t('pastry.chatPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
              style={[styles.input, { color: colors.text }]}
            />
          </View>
          <Pressable onPress={send} disabled={sending || !body.trim()} accessibilityRole="button" accessibilityLabel={t('common.send')}
            style={[styles.send, { backgroundColor: PASTRY.raspberry, opacity: sending || !body.trim() ? 0.6 : 1 }]}>
            <Ionicons name={sending ? 'hourglass-outline' : 'send'} size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md, maxWidth: '92%' },
  day: { alignSelf: 'center', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 4, marginVertical: spacing.sm },
  bubble: {
    maxWidth: '82%', borderRadius: 14, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, gap: 2,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 24, paddingHorizontal: spacing.md, minHeight: 48 },
  input: { flex: 1, fontSize: 16, maxHeight: 120, paddingVertical: Platform.OS === 'ios' ? 12 : 8 },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
