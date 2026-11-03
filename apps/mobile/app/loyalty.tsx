import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { LoyaltyCard, LoyaltyCardMini, CARD_THEMES } from '@/components/LoyaltyCard';
import { Button, Card, ErrorState, Loading, Notice, Row, Screen, SectionHeader, T, type IconName } from '@/components/ui';
import { useLinkLoyaltyCard, useLoyalty } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatCdf, formatDate, formatPoints } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n';
import { TIERS, isTier } from '@/lib/loyalty';
import { radius, spacing } from '@/lib/theme';
import type { LoyaltyTier, LoyaltyTransaction } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

// Publicités Kin Marché Fidélité+ (visuels officiels du programme).
const ADS = [
  { src: require('../assets/images/loyalty/promo-fidelite.jpg'), ratio: 993 / 1024, label: 'loyalty.ad.program' as TranslationKey },
  { src: require('../assets/images/loyalty/promo-points.jpg'), ratio: 1200 / 1238, label: 'loyalty.ad.points' as TranslationKey },
];

const TX_ICON: Record<LoyaltyTransaction['type'], IconName> = {
  earn: 'add-circle-outline', redeem: 'remove-circle-outline', adjust: 'swap-vertical-outline',
  refund_reversal: 'arrow-undo-outline', expire: 'time-outline',
};

export default function Loyalty() {
  const { t, money, language, colors } = useSettings();
  const q = useLoyalty();
  const link = useLinkLoyaltyCard();
  const [linkResult, setLinkResult] = useState<'found' | 'none' | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<(typeof ADS)[number] | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={t('common.error')} onRetry={q.refetch} />;
  const { card, history } = q.data;
  const tier: LoyaltyTier | null = isTier(card.tier) ? card.tier : null;
  const hasCard = card.card_status !== 'none' && !!card.card_number && !!tier;
  const minAmount = formatCdf(card.enroll_min_cdf, language);
  const bonus = (k: LoyaltyTier) => Math.round((card.tier_bonus?.[k] ?? 0) * 100);

  const findCard = async () => {
    setLinkError(null);
    setLinkResult(null);
    try {
      const res = await link.mutateAsync();
      setLinkResult(res.found ? 'found' : 'none');
    } catch (e) {
      setLinkError(errorMessage(e, t));
    }
  };

  return (
    <Screen>
      {hasCard ? (
        <>
          <LoyaltyCard number={card.card_number!} name={card.full_name} tier={tier!}
            phone={card.phone_card_number ?? card.card_number} suspended={card.card_status === 'suspended'} />
          {card.card_status === 'suspended' ? <Notice tone="danger" text={t('loyalty.suspendedText')} /> : null}
          {card.locked_points > 0 ? <Notice tone="warning" text={t('loyalty.lockedText', { points: formatPoints(card.locked_points, language) })} /> : null}
        </>
      ) : (
        <>
          <LoyaltyCardMini number={card.phone_card_number} name={card.full_name} tier="silver" pending />
          <Card style={{ gap: spacing.sm }}>
            <Row gap={10}>
              <View style={[styles.round, { backgroundColor: colors.primarySoft }]}><Ionicons name="card-outline" size={20} color={colors.primary} /></View>
              <T weight="800" size="lg" style={{ flex: 1 }}>{t('loyalty.noCard.title')}</T>
            </Row>
            <T size="sm" style={{ lineHeight: 20 }}>{t('loyalty.noCard.text', { amount: minAmount })}</T>
            {card.phone_card_number ? (
              <T size="sm" muted>{t('loyalty.noCard.number', { number: card.phone_card_number })}</T>
            ) : null}
            {card.enroll_eligible ? <Notice tone="success" text={t('loyalty.eligible')} /> : null}
            {!card.phone_card_number ? (
              <>
                <Notice tone="warning" text={t('loyalty.phoneMissing')} />
                <Button title={t('loyalty.addPhone')} icon="call-outline" variant="secondary" onPress={() => router.push('/me/profile')} />
              </>
            ) : null}
            {card.phone_card_taken ? <Notice tone="warning" text={t('loyalty.phoneTaken')} /> : null}
          </Card>
          {!card.legacy && card.phone_card_number ? (
            <Card style={{ gap: spacing.sm }}>
              <T weight="800">{t('loyalty.member.title')}</T>
              <T size="sm" muted style={{ lineHeight: 19 }}>{t('loyalty.member.text')}</T>
              <Button title={t('loyalty.find')} icon="search-outline" variant="secondary" loading={link.isPending} onPress={findCard} />
              {linkResult === 'found' ? <Notice tone="success" text={t('loyalty.findFound')} /> : null}
              {linkResult === 'none' ? <Notice text={t('loyalty.findNone')} /> : null}
              {linkError ? <Notice tone="danger" text={linkError} /> : null}
            </Card>
          ) : null}
        </>
      )}

      {/* Solde */}
      <Card style={{ gap: spacing.md }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <T size="sm" muted>{t('loyalty.points')}</T>
            <T size="xxl" weight="800" color={colors.primary}>{formatPoints(card.points_balance, language)}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T size="sm" muted>{t('loyalty.value')}</T>
            <T weight="800">{money(card.redeemable_points * card.point_value_usd)}</T>
          </View>
        </Row>
        <Row gap={8}>
          <View style={[styles.stat, { borderColor: colors.border }]}>
            <T size="xs" muted>{t('loyalty.redeemable')}</T>
            <T weight="800">{formatPoints(card.redeemable_points, language)}</T>
          </View>
          <View style={[styles.stat, { borderColor: colors.border }]}>
            <T size="xs" muted>{t('loyalty.lifetime')}</T>
            <T weight="800">{formatPoints(card.lifetime_points, language)}</T>
          </View>
        </Row>
      </Card>

      {/* Niveaux de la carte */}
      <SectionHeader title={t('loyalty.levels')} />
      <Card style={{ gap: spacing.md }}>
        {TIERS.map((k) => (
          <Row key={k} gap={12} style={{ alignItems: 'center' }}>
            <View style={[styles.swatch, { backgroundColor: CARD_THEMES[k].stops[1][1], borderColor: CARD_THEMES[k].stops[2][1] }]}>
              <T size="xs" weight="900" color={CARD_THEMES[k].text}>{t(`loyalty.tier.${k}`).slice(0, 1)}</T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Row gap={6}>
                <T weight="800">{t(`loyalty.tier.${k}`)}</T>
                {hasCard && tier === k ? (
                  <View style={[styles.tag, { backgroundColor: colors.primary }]}><T size="xs" weight="700" color={colors.onPrimary}>{t('loyalty.yourLevel')}</T></View>
                ) : null}
              </Row>
              <T size="sm" muted style={{ lineHeight: 18 }}>
                {k === 'silver' ? t('loyalty.level.silver', { amount: minAmount }) : t('loyalty.level.bonus', { bonus: bonus(k) })}
              </T>
            </View>
          </Row>
        ))}
        <T size="xs" muted>{t('loyalty.levelsNote')}</T>
      </Card>

      {/* Fonctionnement */}
      <SectionHeader title={t('loyalty.how')} />
      <Card style={{ gap: spacing.sm }}>
        {([
          ['cash-outline', t('loyalty.how.earn', { amount: money(1 / Math.max(card.earn_per_usd, 0.0001)) })],
          ['pricetag-outline', t('loyalty.how.use', { value: money(card.point_value_usd) })],
          ['storefront-outline', t('loyalty.how.store')],
          ['arrow-undo-outline', t('loyalty.how.cancel')],
        ] as [IconName, string][]).map(([icon, text]) => (
          <Row key={text} gap={10} style={{ alignItems: 'flex-start' }}>
            <Ionicons name={icon} size={18} color={colors.accent2} style={{ marginTop: 1 }} />
            <T size="sm" style={{ flex: 1, lineHeight: 19 }}>{text}</T>
          </Row>
        ))}
        <Button title={t('loyalty.space', { name: card.program.name })} icon="open-outline" variant="ghost"
          onPress={() => Linking.openURL(card.program.url)} />
        {card.program.phone ? (
          <Button title={t('loyalty.call', { phone: card.program.phone })} icon="call-outline" variant="ghost"
            onPress={() => Linking.openURL(`tel:${card.program.phone}`)} />
        ) : null}
      </Card>

      {/* Historique */}
      <SectionHeader title={t('loyalty.history')} />
      <Card>
        {history.length === 0 ? <T muted size="sm">{t('loyalty.historyEmpty')}</T> : history.map((h, i) => (
          <Row key={h.id} gap={10} style={{ paddingVertical: 8, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: colors.border }}>
            <Ionicons name={TX_ICON[h.type] ?? 'ellipse-outline'} size={20} color={h.points >= 0 ? colors.success : colors.danger} />
            <View style={{ flex: 1 }}>
              <T size="sm" numberOfLines={2}>{h.note ?? t(`loyalty.tx.${h.type}`)}</T>
              <T size="xs" muted>{formatDate(h.created_at, language)}</T>
            </View>
            <T weight="800" color={h.points >= 0 ? colors.success : colors.danger}>{h.points > 0 ? '+' : ''}{formatPoints(h.points, language)}</T>
          </Row>
        ))}
      </Card>

      {/* Publicités Kin Marché Fidélité */}
      <SectionHeader title={t('loyalty.ads')} />
      {ADS.map((ad) => (
        <Pressable key={ad.label} onPress={() => setZoom(ad)} accessibilityRole="imagebutton" accessibilityLabel={t(ad.label)}>
          <View style={[styles.ad, { borderColor: colors.border }]}>
            <Image source={ad.src} style={{ width: '100%', aspectRatio: ad.ratio }} contentFit="cover" transition={200} />
          </View>
        </Pressable>
      ))}

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)} statusBarTranslucent>
        <Pressable style={styles.lightbox} onPress={() => setZoom(null)} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          {zoom ? <Image source={zoom.src} style={{ width: '100%', aspectRatio: zoom.ratio }} contentFit="contain" /> : null}
          <View style={styles.close}><Ionicons name="close" size={26} color="#FFFFFF" /></View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stat: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  ad: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  close: { position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
