import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CategoryIcon, ChefCard, PastryStatusPill, PastryTimeline, RequestDetails } from '@/components/Pastry';
import { Button, Chip, EmptyState, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { useAddresses } from '@/hooks/data';
import { usePastryMessages, usePastryOrder } from '@/hooks/pastry';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { PASTRY, desiredLabel } from '@/lib/pastry';
import { supabase, unwrap } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Suivi d'une commande pâtisserie (client) : parcours, prix proposé à accepter, paiement, discussion
// avec la pâtisserie, puis suivi de la livraison.
export default function PastryOrderScreen() {
  const { id, sent } = useLocalSearchParams<{ id: string; sent?: string }>();
  const { t, colors, money, language } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const order = usePastryOrder(id);
  const messages = usePastryMessages(id);
  const addresses = useAddresses();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState<'accept' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const o = order.data;
  // Adresse : celle indiquée dans la demande si elle existe encore, sinon la première.
  useEffect(() => {
    if (addressId || !addresses.data?.length) return;
    const wanted = (o?.delivery_address as { id?: string } | null)?.id;
    setAddressId(addresses.data.find((a) => a.id === wanted)?.id ?? addresses.data[0].id);
  }, [addresses.data, addressId, o?.delivery_address]);

  if (order.isLoading) return <Loading />;
  if (!o) return <Screen><EmptyState icon="alert-circle-outline" message={t('err.PASTRY_ORDER_NOT_FOUND')} /></Screen>;

  const uid = session?.user.id;
  const last = (messages.data ?? []).slice(-2);
  const fromChef = (messages.data ?? []).filter((m) => m.sender_id !== uid).length;

  const accept = async () => {
    setError(null);
    if (!addressId) return setError(t('pastry.errAddress'));
    setBusy('accept');
    try {
      const res = unwrap(await supabase.rpc('pastry_accept_quote', {
        p_id: o.id, p_address_id: addressId, p_instructions: instructions.trim() || null,
      })) as { order_id: string };
      qc.invalidateQueries({ queryKey: ['pastry'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      router.push(`/payment/${res.order_id}`);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    Alert.alert(t('pastry.cancelConfirm'), t('pastry.cancelText'), [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('pastry.cancel'), style: 'destructive', onPress: async () => {
          setBusy('cancel');
          setError(null);
          try {
            unwrap(await supabase.rpc('pastry_cancel', { p_id: o.id, p_reason: null }));
            qc.invalidateQueries({ queryKey: ['pastry'] });
          } catch (e) {
            setError(errorMessage(e, t));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const canCancel = ['submitted', 'quoted', 'accepted'].includes(o.status);
  const paidOrLater = ['paid', 'in_preparation', 'ready', 'delivering', 'delivered'].includes(o.status);

  return (
    <Screen>
      <Stack.Screen options={{ title: o.request_number ?? t('pastry.title') }} />

      {sent === '1' && o.status === 'submitted' ? <Notice tone="success" text={t('pastry.sent')} /> : null}

      {/* En-tête de la demande */}
      <View style={[styles.head, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
          <CategoryIcon category={o.category} size={52} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size="lg" weight="800">{o.cake_type}</T>
            <T size="xs" muted>{t('pastry.request', { n: o.request_number ?? '' })} · {formatDate(o.created_at, language)}</T>
            <Row gap={4}>
              <Ionicons name="storefront-outline" size={13} color={colors.textMuted} />
              <T size="xs" muted numberOfLines={1}>{o.stores?.name ?? ''}</T>
            </Row>
          </View>
          <PastryStatusPill status={o.status} />
        </Row>
        <View style={[styles.when, { backgroundColor: `${PASTRY.caramel}1F` }]}>
          <Ionicons name={o.desired_at ? 'calendar' : 'flash'} size={16} color={PASTRY.choco} />
          <T size="sm" weight="700" color={PASTRY.choco} style={{ flex: 1 }}>
            {o.desired_at ? t('pastry.for', { date: desiredLabel(o.desired_at, language, t) }) : t('pastry.forAsap')}
          </T>
        </View>
      </View>

      {/* Prix proposé : à accepter */}
      {o.status === 'submitted' ? (
        <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Row gap={spacing.sm}>
            <MaterialCommunityIcons name="chef-hat" size={22} color={PASTRY.raspberry} />
            <T weight="800" style={{ flex: 1 }}>{t('pastry.status.submitted')}</T>
          </Row>
          <T size="sm" muted style={{ lineHeight: 20 }}>{t('pastry.waitingQuote')}</T>
        </View>
      ) : null}

      {o.status === 'quoted' && o.quoted_price_usd != null ? (
        <View style={[styles.quote, { borderColor: PASTRY.raspberry }]}>
          <Row gap={spacing.sm}>
            <Ionicons name="pricetag" size={18} color={PASTRY.raspberry} />
            <T weight="800" style={{ flex: 1 }}>{t('pastry.quoteTitle')}</T>
            {o.quoted_at ? <T size="xs" muted>{formatDate(o.quoted_at, language)}</T> : null}
          </Row>
          <View style={styles.priceRow}>
            <T size="sm" muted>{t('pastry.quotePrice')}</T>
            <T size="xxl" weight="800" color={PASTRY.choco}>{money(o.quoted_price_usd)}</T>
          </View>
          {o.quote_details ? <T size="sm" style={{ lineHeight: 20 }}>{o.quote_details}</T> : null}
          <T size="xs" muted>{t('pastry.quoteExtra')}</T>

          <T size="sm" weight="700">{t('pastry.chooseAddress')}</T>
          {(addresses.data ?? []).length ? (
            <View style={styles.wrap}>
              {(addresses.data ?? []).map((a) => (
                <Chip key={a.id} icon="home-outline" label={`${a.label} · ${a.commune}`} active={a.id === addressId} onPress={() => setAddressId(a.id)} />
              ))}
            </View>
          ) : <Notice tone="warning" text={t('pastry.errAddress')} />}
          <Button title={t('pastry.addAddress')} icon="add-circle-outline" variant="ghost" onPress={() => router.push('/addresses/new')} />
          <Input label={t('pastry.instructions')} value={instructions} onChangeText={setInstructions} maxLength={300} />
          <Button title={t('pastry.acceptPay')} icon="card-outline" loading={busy === 'accept'} disabled={!addressId} onPress={accept} />
        </View>
      ) : null}

      {o.status === 'accepted' && o.order_id ? (
        <View style={[styles.quote, { borderColor: '#0097FC' }]}>
          <Row gap={spacing.sm}>
            <Ionicons name="card" size={18} color="#0097FC" />
            <T weight="800" style={{ flex: 1 }}>{t('pastry.payHint')}</T>
          </Row>
          {o.quoted_price_usd != null ? <T size="sm" muted>{t('pastry.quotePrice')} : {money(o.quoted_price_usd)} · {o.order_number}</T> : null}
          <Button title={t('pastry.payNow')} icon="card-outline" onPress={() => router.push(`/payment/${o.order_id}`)} />
        </View>
      ) : null}

      {paidOrLater && o.order_id ? (
        <Pressable onPress={() => router.push(`/order/${o.order_id}`)} accessibilityRole="button"
          style={({ pressed }) => [styles.track, { backgroundColor: PASTRY.choco, opacity: pressed ? 0.9 : 1 }]}>
          <View style={styles.trackIcon}><MaterialCommunityIcons name={o.status === 'delivering' ? 'moped' : 'cake-variant'} size={20} color={PASTRY.raspberry} /></View>
          <View style={{ flex: 1 }}>
            <T weight="800" color="#FFFFFF">{t('pastry.track')}</T>
            <T size="xs" color={PASTRY.cocoaText}>{o.order_number ?? ''} · {t(`pastry.status.${o.status}` as 'pastry.status.paid')}</T>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {o.status === 'rejected' ? <Notice tone="warning" text={t('pastry.rejectedText', { reason: o.reject_reason ?? '—' })} /> : null}
      {o.status === 'cancelled' ? <Notice tone="info" text={o.reject_reason ? `${t('pastry.cancelled')} ${o.reject_reason}` : t('pastry.cancelled')} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}

      <ChefCard chefId={o.chef_id} />

      {/* Discussion avec la pâtisserie */}
      <Pressable onPress={() => router.push(`/pastry-chat/${o.id}`)} accessibilityRole="button"
        style={({ pressed }) => [styles.box, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.92 : 1 }]}>
        <Row gap={spacing.sm}>
          <View style={[styles.chatIcon, { backgroundColor: `${PASTRY.raspberry}1F` }]}>
            <Ionicons name="chatbubbles" size={18} color={PASTRY.raspberry} />
          </View>
          <View style={{ flex: 1 }}>
            <T weight="800">{t('pastry.chat')}</T>
            <T size="xs" muted>{fromChef ? t('pastry.chatCount', { n: messages.data?.length ?? 0 }) : t('pastry.chatEmpty')}</T>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Row>
        {last.map((m) => (
          <View key={m.id} style={[styles.preview, { backgroundColor: m.sender_id === uid ? `${PASTRY.raspberry}14` : colors.surfaceAlt, alignSelf: m.sender_id === uid ? 'flex-end' : 'flex-start' }]}>
            <T size="xs" weight="700" color={m.sender_id === uid ? PASTRY.raspberryDeep : PASTRY.choco}>{m.sender_id === uid ? t('pastry.you') : t('pastry.title')}</T>
            <T size="sm" numberOfLines={2}>{m.body}</T>
          </View>
        ))}
      </Pressable>

      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <T weight="800">{t('pastry.progress')}</T>
        <PastryTimeline order={o} />
      </View>

      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <T weight="800">{t('pastry.whatOrdered')}</T>
        <RequestDetails order={o} />
      </View>

      {canCancel ? <Button title={t('pastry.cancel')} icon="close-circle-outline" variant="ghost" loading={busy === 'cancel'} onPress={cancel} /> : null}
      {['delivered', 'rejected', 'cancelled'].includes(o.status) ? (
        <Button title={t('pastry.newOrder')} icon="add-circle-outline" variant="secondary" onPress={() => router.push('/cake')} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  when: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  box: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  quote: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  track: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, minHeight: 64 },
  trackIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: PASTRY.cream, alignItems: 'center', justifyContent: 'center' },
  chatIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  preview: { maxWidth: '88%', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, gap: 1 },
});
