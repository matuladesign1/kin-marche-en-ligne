import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CategoryIcon, PastryStatusPill, RequestDetails } from '@/components/Pastry';
import { Button, EmptyState, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { usePastryMessages, usePastryOrder } from '@/hooks/pastry';
import { errorMessage } from '@/lib/errors';
import { formatDate, timeAgo } from '@/lib/format';
import { PASTRY, PREP_STEPS, desiredLabel, isUrgent, nextPrepStatus, prepRank } from '@/lib/pastry';
import { homeForRole } from '@/lib/roles';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Commande vue par le pâtissier : demande du client, prix à proposer (ou refus motivé), puis les étapes
// de préparation jusqu'à la remise au livreur Kin Marché, et la discussion avec le client.
export default function ChefOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, colors, money, language } = useSettings();
  const { profile, session, loading } = useAuth();
  const qc = useQueryClient();
  const order = usePastryOrder(id);
  const messages = usePastryMessages(id);
  const [price, setPrice] = useState('');
  const [quoteDetails, setQuoteDetails] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const o = order.data;
  useEffect(() => {
    if (!o) return;
    if (o.quoted_price_usd != null) setPrice((v) => v || String(o.quoted_price_usd));
    if (o.quote_details) setQuoteDetails((v) => v || o.quote_details || '');
  }, [o]);

  if (loading || order.isLoading) return <Loading />;
  if (profile?.role !== 'pastry_chef') return <Redirect href={homeForRole(profile?.role)} />;
  if (!o) return <Screen><EmptyState icon="alert-circle-outline" message={t('err.PASTRY_ORDER_NOT_FOUND')} /></Screen>;

  const uid = session?.user.id;
  const takenByOther = !!o.chef_id && o.chef_id !== uid;
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['pastry'] });
      if (done) setInfo(done);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  };

  const sendQuote = () => {
    const value = Number(price.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return setError(t('err.INVALID_PRICE'));
    run('quote', async () => unwrap(await supabase.rpc('pastry_quote', { p_id: o.id, p_price: value, p_details: quoteDetails.trim() || null })), t('pastryChef.quoteSent'));
  };
  const reject = () => {
    if (!reason.trim()) return setError(t('err.REASON_REQUIRED'));
    setRejectOpen(false);
    run('reject', async () => unwrap(await supabase.rpc('pastry_reject', { p_id: o.id, p_reason: reason.trim() })));
  };
  const next = nextPrepStatus(o.order_status);
  const advance = () => {
    if (!next) return;
    run('advance', async () => unwrap(await supabase.rpc('pastry_advance', { p_id: o.id, p_status: next })));
  };

  const rank = prepRank(o.order_status);
  const paid = ['paid', 'in_preparation', 'ready', 'delivering', 'delivered'].includes(o.status);
  const urgent = isUrgent(o);
  const msgCount = messages.data?.length ?? 0;
  const lastFromCustomer = [...(messages.data ?? [])].reverse().find((m) => m.sender_id === o.customer_id);

  return (
    <Screen>
      <Stack.Screen options={{ title: o.request_number ?? t('pastryChef.space') }} />

      {/* Client et échéance */}
      <View style={[styles.head, { backgroundColor: colors.surface, borderColor: urgent ? PASTRY.raspberry : colors.border }]}>
        <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
          <CategoryIcon category={o.category} size={52} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size="lg" weight="800">{o.cake_type}</T>
            <T size="xs" muted>{o.request_number} · {timeAgo(o.created_at, language, t)}</T>
          </View>
          <PastryStatusPill status={o.status} />
        </Row>
        <View style={[styles.when, { backgroundColor: urgent ? `${PASTRY.raspberry}1A` : `${PASTRY.caramel}1F` }]}>
          <Ionicons name={o.desired_at ? 'alarm-outline' : 'flash-outline'} size={18} color={urgent ? PASTRY.raspberryDeep : PASTRY.choco} />
          <T size="sm" weight="800" color={urgent ? PASTRY.raspberryDeep : PASTRY.choco} style={{ flex: 1 }}>
            {o.desired_at ? t('pastry.for', { date: desiredLabel(o.desired_at, language, t) }) : t('pastry.forAsap')}
          </T>
          {urgent ? <T size="xs" weight="800" color={PASTRY.raspberryDeep}>{t('pastryChef.urgent').toUpperCase()}</T> : null}
        </View>
        <Row gap={spacing.md}>
          <View style={[styles.person, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="person" size={18} color={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <T size="xs" muted>{t('pastryChef.customer')}</T>
            <T weight="700" numberOfLines={1}>{o.full_name}</T>
          </View>
          <Button title={t('common.call')} icon="call-outline" variant="secondary" style={styles.callBtn}
            onPress={() => Linking.openURL(`tel:${o.phone}`)} />
        </Row>
        {takenByOther ? <Notice tone="info" text={t('pastryChef.takenByOther')} /> : null}
      </View>

      {info ? <Notice tone="success" text={info} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}

      {/* Prix à proposer (ou à corriger tant que le client n'a pas accepté) */}
      {(o.status === 'submitted' || o.status === 'quoted') && !takenByOther ? (
        <View style={[styles.box, { backgroundColor: colors.surface, borderColor: PASTRY.raspberry, borderWidth: 2 }]}>
          <Row gap={spacing.sm}>
            <Ionicons name="pricetag" size={18} color={PASTRY.raspberry} />
            <T weight="800" style={{ flex: 1 }}>{o.status === 'quoted' ? t('pastryChef.updateQuote') : t('pastryChef.quoteTitle')}</T>
          </Row>
          {o.status === 'quoted' && o.quoted_price_usd != null ? <T size="sm" muted>{t('pastryChef.waitAccept', { price: money(o.quoted_price_usd) })}</T> : null}
          <Input label={t('pastryChef.price')} value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.,]/g, '').slice(0, 9))}
            keyboardType="decimal-pad" placeholder="25" />
          <Input label={t('pastryChef.quoteDetails')} value={quoteDetails} onChangeText={setQuoteDetails} multiline maxLength={1000}
            style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 12 }} placeholder={t('pastryChef.quoteDetailsHint')} />
          <Button title={o.status === 'quoted' ? t('pastryChef.updateQuote') : t('pastryChef.sendQuote')} icon="send-outline"
            loading={busy === 'quote'} onPress={sendQuote} />
          <Button title={t('pastryChef.reject')} icon="close-circle-outline" variant="ghost" loading={busy === 'reject'} onPress={() => setRejectOpen(true)} />
        </View>
      ) : null}

      {o.status === 'accepted' ? (
        <Notice tone="info" text={t('pastryChef.waitPayment', { price: money(o.quoted_price_usd ?? 0) })} />
      ) : null}

      {/* Étapes de préparation, une fois la commande payée */}
      {paid ? (
        <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Row gap={spacing.sm}>
            <MaterialCommunityIcons name="chef-hat" size={20} color={PASTRY.choco} />
            <T weight="800" style={{ flex: 1 }}>{t('pastryChef.steps')}</T>
            {o.order_number ? <T size="xs" muted>{t('pastryChef.orderNumber', { n: o.order_number })}</T> : null}
          </Row>
          <View style={styles.stepper}>
            {PREP_STEPS.map((s, i) => {
              const done = i <= rank;
              const current = i === rank + 1 && o.status !== 'delivered';
              const color = done ? PASTRY.pistachio : current ? PASTRY.raspberry : colors.border;
              return (
                <View key={s} style={styles.stepItem}>
                  <View style={styles.stepTop}>
                    {i > 0 ? <View style={[styles.stepLine, { backgroundColor: i <= rank ? PASTRY.pistachio : colors.border }]} /> : <View style={{ flex: 1 }} />}
                    <View style={[styles.stepDot, { backgroundColor: done ? PASTRY.pistachio : colors.surface, borderColor: color }]}>
                      {done ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : <T size="xs" weight="800" color={current ? PASTRY.raspberry : colors.textMuted}>{i + 1}</T>}
                    </View>
                    {i < PREP_STEPS.length - 1 ? <View style={[styles.stepLine, { backgroundColor: i < rank ? PASTRY.pistachio : colors.border }]} /> : <View style={{ flex: 1 }} />}
                  </View>
                  <T size="xs" weight={current ? '800' : '600'} muted={!done && !current} style={{ textAlign: 'center' }} numberOfLines={2}>
                    {t(`pastryChef.step.${s}` as 'pastryChef.step.preparing')}
                  </T>
                </View>
              );
            })}
          </View>
          {o.order_status === 'sent_to_store' ? <T size="sm" color={colors.success} weight="700">{t('pastryChef.paidNow')}</T> : null}
          {next && !takenByOther ? (
            <Button title={t(`pastryChef.next.${next}` as 'pastryChef.next.preparing')} icon={next === 'ready' ? 'bicycle-outline' : 'checkmark-circle-outline'}
              loading={busy === 'advance'} onPress={advance} />
          ) : null}
          {rank === 3 ? <Notice tone="info" text={t('pastryChef.driverComing')} /> : null}
          {rank === 4 ? <Notice tone="info" text={t('pastryChef.onTheWay')} /> : null}
          {o.status === 'delivered' ? <Notice tone="success" text={t('pastryChef.deliveredText')} /> : null}
        </View>
      ) : null}

      {o.status === 'rejected' ? <Notice tone="warning" text={t('pastry.rejectedText', { reason: o.reject_reason ?? '—' })} /> : null}
      {o.status === 'cancelled' ? <Notice tone="info" text={o.reject_reason ? `${t('pastry.cancelled')} ${o.reject_reason}` : t('pastry.cancelled')} /> : null}

      {/* Discussion avec le client */}
      <Pressable onPress={() => router.push(`/pastry-chat/${o.id}`)} accessibilityRole="button"
        style={({ pressed }) => [styles.box, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.92 : 1 }]}>
        <Row gap={spacing.sm}>
          <View style={[styles.chatIcon, { backgroundColor: `${PASTRY.raspberry}1F` }]}>
            <Ionicons name="chatbubbles" size={18} color={PASTRY.raspberry} />
          </View>
          <View style={{ flex: 1 }}>
            <T weight="800">{t('pastryChef.chatWithCustomer')}</T>
            <T size="xs" muted numberOfLines={2}>
              {lastFromCustomer ? `« ${lastFromCustomer.body} »` : msgCount ? t('pastry.chatCount', { n: msgCount }) : t('pastryChef.chatEmpty')}
            </T>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Row>
      </Pressable>

      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <T weight="800">{t('pastryChef.request')}</T>
        <RequestDetails order={o} />
        <T size="xs" muted>{t('pastryChef.received', { date: formatDate(o.created_at, language) })}</T>
      </View>

      <Modal visible={rejectOpen} transparent animationType="slide" onRequestClose={() => setRejectOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setRejectOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <T size="lg" weight="800">{t('pastryChef.rejectTitle')}</T>
          <Input label={t('pastryChef.rejectReason')} value={reason} onChangeText={setReason} multiline maxLength={500}
            style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 12 }} placeholder={t('pastryChef.rejectHint')} />
          <Button title={t('pastryChef.rejectConfirm')} icon="close-circle-outline" variant="danger" onPress={reject} />
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setRejectOpen(false)} />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  when: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  person: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  callBtn: { minHeight: 40, paddingHorizontal: 12 },
  box: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  stepper: { flexDirection: 'row' },
  stepItem: { flex: 1, alignItems: 'center', gap: 6 },
  stepTop: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLine: { flex: 1, height: 2 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  chatIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
});
