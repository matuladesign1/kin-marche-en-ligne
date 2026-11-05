import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, Modal, RefreshControl, ScrollView, StyleSheet, View,
} from 'react-native';
import { GradientBg, Panel, PanelHeader, WheelIcon } from '@/components/kit';
import { Button, EmptyState, Loading, Notice, Row, T, type IconName } from '@/components/ui';
import { landingDelta, Wheel } from '@/components/Wheel';
import { useSpinWheel, useWheel } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatPoints } from '@/lib/format';
import { localized } from '@/lib/i18n';
import { NEXT_COUPON_KEY } from '@/lib/orders';
import { radius, spacing } from '@/lib/theme';
import type { SpinResult, WheelPrize, WheelReward } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const WHEEL_SIZE = Math.min(Dimensions.get('window').width - 40, 360);

function prizeIcon(kind: WheelPrize['kind']): IconName {
  switch (kind) {
    case 'points': return 'star';
    case 'coupon_percent': case 'coupon_fixed': return 'pricetags';
    case 'product': return 'gift';
    case 'extra_spin': return 'refresh-circle';
    default: return 'happy-outline';
  }
}

/** Code promo : copier ou utiliser à la prochaine commande. */
function CouponActions({ code }: { code: string }) {
  const { t } = useSettings();
  const [copied, setCopied] = useState(false);
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      <Button title={copied ? t('wheel.copied') : t('wheel.copy')} variant="secondary" icon={copied ? 'checkmark' : 'copy-outline'}
        onPress={async () => { await Clipboard.setStringAsync(code); setCopied(true); }} />
      <Button title={t('wheel.useCode')} icon="cart-outline" onPress={async () => {
        await AsyncStorage.setItem(NEXT_COUPON_KEY, code).catch(() => undefined);
        router.push('/(customer)/cart');
      }} />
    </Row>
  );
}

function RewardItem({ r }: { r: WheelReward }) {
  const { t, colors, language, money } = useSettings();
  const isCoupon = r.kind === 'coupon_percent' || r.kind === 'coupon_fixed';
  const expired = isCoupon && !!r.coupon_ends_at && Date.parse(r.coupon_ends_at) < Date.now();
  let state: string;
  let tone = colors.success;
  if (r.status === 'cancelled') { state = t('wheel.state.cancelled'); tone = colors.danger; }
  else if (isCoupon) {
    if (r.coupon_used) { state = t('wheel.state.used'); tone = colors.textMuted; }
    else if (!r.coupon_active) { state = t('wheel.state.cancelled'); tone = colors.danger; }
    else if (expired) { state = t('wheel.state.expired'); tone = colors.textMuted; }
    else state = t('wheel.state.toUse');
  } else if (r.kind === 'product') {
    state = r.status === 'delivered' ? t('wheel.state.delivered')
      : r.status === 'attached' ? t('wheel.state.attached', { order: r.order_number ?? '' }) : t('wheel.state.pending');
    tone = r.status === 'delivered' ? colors.textMuted : colors.warning;
  } else state = r.kind === 'points' ? t('wheel.state.credited') : t('wheel.state.extra');

  const usable = isCoupon && r.status === 'issued' && !r.coupon_used && r.coupon_active && !expired && r.coupon_code;
  return (
    <View style={[styles.reward, { borderColor: colors.border }]}>
      <Row gap={spacing.md}>
        <View style={[styles.rewardIcon, { backgroundColor: colors.surfaceAlt }]}>
          {r.image_url ? <Image source={{ uri: r.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            : <Ionicons name={prizeIcon(r.kind)} size={22} color={colors.primary} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="800">{r.kind === 'points' && r.points ? `+${formatPoints(r.points, language)} points` : r.label}</T>
          <T size="xs" weight="700" color={tone}>{state}</T>
          <T size="xs" muted>{formatDate(r.created_at, language)}</T>
        </View>
      </Row>
      {isCoupon && r.coupon_code ? (
        <View style={[styles.code, { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}>
          <T size="lg" weight="800" color={colors.primary} style={{ letterSpacing: 1 }}>{r.coupon_code}</T>
          <T size="xs" muted>
            {r.coupon_min_order_usd ? t('wheel.minOrder', { amount: money(r.coupon_min_order_usd) }) + ' · ' : ''}
            {r.coupon_ends_at ? t('wheel.validUntil', { date: formatDate(r.coupon_ends_at, language, false) }) : ''}
          </T>
        </View>
      ) : null}
      {r.kind === 'product' && r.status !== 'cancelled' && r.status !== 'delivered' ? (
        <T size="xs" muted>{t('wheel.giftCode', { code: r.claim_code })}</T>
      ) : null}
      {r.note && r.status === 'cancelled' ? <T size="xs" muted>{r.note}</T> : null}
      {usable ? <CouponActions code={r.coupon_code!} /> : null}
    </View>
  );
}

function ResultModal({ result, onClose }: { result: SpinResult | null; onClose: () => void }) {
  const { t, colors, money, language } = useSettings();
  if (!result) return null;
  const lost = result.kind === 'nothing';
  const isCoupon = result.kind === 'coupon_percent' || result.kind === 'coupon_fixed';
  let detail = '';
  if (result.kind === 'points') detail = t('wheel.result.points', { points: formatPoints(result.value, language) });
  else if (isCoupon) detail = t('wheel.result.coupon', {
    date: result.coupon_ends_at ? formatDate(result.coupon_ends_at, language, false) : '',
    amount: money(result.min_order_usd),
  });
  else if (result.kind === 'product') detail = t('wheel.result.product');
  else if (result.kind === 'extra_spin') detail = t('wheel.result.extra');
  else detail = t('wheel.result.nothing');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={[styles.modal, { backgroundColor: colors.surface }]}>
          <View style={[styles.resultIcon, { backgroundColor: lost ? colors.surfaceAlt : colors.primarySoft }]}>
            {result.kind === 'extra_spin' ? <WheelIcon size={46} /> : <Ionicons name={lost ? 'happy-outline' : prizeIcon(result.kind)} size={46} color={lost ? colors.textMuted : colors.primary} />}
          </View>
          <T size="xl" weight="800" style={{ textAlign: 'center' }}>{lost ? t('wheel.result.lostTitle') : t('wheel.result.title')}</T>
          {!lost ? <T size="lg" weight="800" color={colors.primary} style={{ textAlign: 'center' }}>{result.label}</T> : null}
          <T muted style={{ textAlign: 'center' }}>{detail}</T>
          {isCoupon && result.coupon_code ? (
            <View style={[styles.code, { borderColor: colors.primary, backgroundColor: colors.primarySoft, alignSelf: 'stretch' }]}>
              <T size="xl" weight="800" color={colors.primary} style={{ letterSpacing: 1.5, textAlign: 'center' }}>{result.coupon_code}</T>
            </View>
          ) : null}
          {isCoupon && result.coupon_code ? <CouponActions code={result.coupon_code} /> : null}
          <Button style={{ alignSelf: 'stretch' }} variant={isCoupon ? 'ghost' : 'primary'}
            title={result.spins_left > 0 ? t('wheel.result.again', { n: result.spins_left }) : t('common.continue')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export default function WheelScreen() {
  const { t, colors, money, language } = useSettings();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ section?: string }>();
  const wheel = useWheel();
  const spin = useSpinWheel();
  const rotation = useRef(new Animated.Value(0)).current;
  const current = useRef(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  // « Mes gains » depuis le compte : on fait défiler jusqu'à la liste des gains.
  const layoutY = useRef<{ inner: number | null; rewards: number | null }>({ inner: null, rewards: null });
  const scrolled = useRef(false);
  const maybeScroll = () => {
    const { inner, rewards } = layoutY.current;
    if (params.section !== 'rewards' || scrolled.current || inner == null || rewards == null) return;
    scrolled.current = true;
    setTimeout(() => scroll.current?.scrollTo({ y: Math.max(inner + rewards - 12, 0), animated: true }), 250);
  };

  const data = wheel.data;
  // Les lots affichés restent figés pendant un tour (même ordre que le tirage côté serveur).
  const [frozen, setFrozen] = useState<WheelPrize[] | null>(null);
  const shown = frozen ?? data?.prizes ?? [];

  if (wheel.isLoading) return <Loading />;
  if (!data || !data.enabled || shown.length === 0) {
    return <EmptyState icon="gift-outline" message={t('wheel.unavailable')} />;
  }

  const spins = data.spins_available ?? 0;

  const go = async () => {
    if (spinning) return;
    setError(null);
    setSpinning(true);
    const prizesAtStart = shown;
    setFrozen(prizesAtStart);
    try {
      const res = await spin.mutateAsync();
      const index = prizesAtStart.findIndex((p) => p.id === res.prize_id);
      const delta = index >= 0 ? landingDelta(current.current, index, prizesAtStart.length) : 360 * 5;
      const target = current.current + delta;
      current.current = target;
      Animated.timing(rotation, { toValue: target, duration: 5200, easing: Easing.out(Easing.cubic), useNativeDriver: true })
        .start(() => { setSpinning(false); setFrozen(null); setResult(res); });
    } catch (e) {
      setSpinning(false);
      setFrozen(null);
      setError(errorMessage(e, t));
      wheel.refetch();
    }
  };

  const rules = [
    t('wheel.rule.earn', { amount: money(data.min_order_usd), n: data.spins_per_order }),
    t('wheel.rule.validity', { days: data.spin_validity_days }),
    t('wheel.rule.coupons'),
    t('wheel.rule.gifts'),
    t('wheel.rule.cancel'),
    t('wheel.rule.fair'),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: spacing.xxl * 2, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={wheel.isRefetching} onRefresh={() => wheel.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}>
        <View style={styles.hero}>
          <GradientBg from={colors.primary} to={colors.primaryDark} />
          <T size="xxl" weight="800" color="#FFFFFF" style={{ textAlign: 'center' }}>{t('wheel.title')}</T>
          <T color="#FFFFFF" style={{ textAlign: 'center', opacity: 0.92 }}>{t('wheel.subtitle')}</T>
          {session ? (
            <View style={styles.spinsPill}>
              <WheelIcon size={20} />
              <T weight="800">{spins === 0 ? t('wheel.spinsNone') : spins === 1 ? t('wheel.spinsOne') : t('wheel.spinsMany', { n: spins })}</T>
            </View>
          ) : null}
          {session && spins > 0 && data.next_expiry ? (
            <T size="xs" color="#FFFFFF" style={{ opacity: 0.85 }}>{t('wheel.expires', { date: formatDate(data.next_expiry, language, false) })}</T>
          ) : null}
          <View style={{ marginTop: spacing.md }}>
            <Wheel prizes={shown} size={WHEEL_SIZE} rotation={rotation} />
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.md, gap: spacing.md }} onLayout={(e) => { layoutY.current.inner = e.nativeEvent.layout.y; maybeScroll(); }}>
          {error ? <Notice tone="warning" text={error} /> : null}
          {!session ? (
            <Button title={t('wheel.signInToPlay')} icon="log-in-outline" onPress={() => router.push('/(auth)/sign-in')} />
          ) : spins > 0 ? (
            <Button title={spinning ? t('wheel.spinning') : t('wheel.spin')} icon="sync-outline" loading={spinning} onPress={go} />
          ) : (
            <Panel>
              <Row gap={spacing.md}>
                <Ionicons name="cart" size={28} color={colors.primary} />
                <T style={{ flex: 1 }}>{t('wheel.howToEarn', { amount: money(data.min_order_usd) })}</T>
              </Row>
              <Button title={t('wheel.goShopping')} variant="secondary" icon="storefront-outline" onPress={() => router.push('/(customer)')} />
            </Panel>
          )}

          {session ? (
            <View onLayout={(e) => { layoutY.current.rewards = e.nativeEvent.layout.y; maybeScroll(); }}>
              <Panel>
                <PanelHeader title={t('wheel.myRewards')} />
                {data.rewards?.length ? data.rewards.map((r) => <RewardItem key={r.id} r={r} />)
                  : <T muted>{t('wheel.noRewards')}</T>}
              </Panel>
            </View>
          ) : null}

          <Panel>
            <PanelHeader title={t('wheel.prizes')} />
            {shown.map((p) => (
              <Row key={p.id} gap={spacing.md}>
                <View style={[styles.swatch, { backgroundColor: p.color }]} />
                <T style={{ flex: 1 }}>{localized(p.label_i18n, language, p.label)}{p.product_name ? <T muted size="sm"> · {p.product_name}</T> : null}</T>
                <T weight="700" muted>{p.chance != null ? `${p.chance.toLocaleString(language)} %` : ''}</T>
              </Row>
            ))}
          </Panel>

          <Panel>
            <PanelHeader title={t('wheel.rules')} />
            {rules.map((rule, i) => (
              <Row key={i} gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} style={{ marginTop: 1 }} />
                <T size="sm" style={{ flex: 1 }}>{rule}</T>
              </Row>
            ))}
          </Panel>

          {session && data.history?.length ? (
            <Panel>
              <PanelHeader title={t('wheel.history')} />
              {data.history.slice(0, 10).map((h, i) => (
                <Row key={i} style={{ justifyContent: 'space-between' }}>
                  <T size="sm" style={{ flex: 1 }}>{h.label}</T>
                  <T size="xs" muted>{formatDate(h.used_at, language)}</T>
                </Row>
              ))}
            </Panel>
          ) : null}
        </View>
      </ScrollView>
      <ResultModal result={result} onClose={() => setResult(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, overflow: 'hidden' },
  spinsPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, marginTop: spacing.sm },
  reward: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, gap: spacing.sm },
  rewardIcon: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  code: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: 2 },
  swatch: { width: 16, height: 16, borderRadius: 4 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.xl },
  modal: { borderRadius: 20, padding: spacing.xl, gap: spacing.md, alignItems: 'center' },
  resultIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
});
