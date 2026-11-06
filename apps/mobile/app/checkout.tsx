import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, Divider, Input, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { qk, useAddresses, useLoyalty, useQuote } from '@/hooks/data';
import { errorMessage, translateIssue } from '@/lib/errors';
import { formatCdf, formatPoints, formatQty, formatRate } from '@/lib/format';
import { NEXT_COUPON_KEY } from '@/lib/orders';
import { supabase, unwrap } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

export default function Checkout() {
  const { t, money, currency, rates, colors, language } = useSettings();
  const qc = useQueryClient();
  const addresses = useAddresses();
  const loyalty = useLoyalty();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<string | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId(addresses.data[0].id);
  }, [addresses.data, addressId]);

  // Code gagné à la Roue de la chance (« Utiliser ce code ») : appliqué automatiquement.
  useEffect(() => {
    AsyncStorage.getItem(NEXT_COUPON_KEY).then((code) => {
      if (!code) return;
      setCouponInput(code);
      setCoupon(code);
      AsyncStorage.removeItem(NEXT_COUPON_KEY).catch(() => undefined);
    }).catch(() => undefined);
  }, []);

  // Seuls les points d'une carte active (hors points en attente de vérification) sont utilisables.
  const usable = loyalty.data?.card.redeemable_points ?? 0;
  const points = usePoints ? usable : 0;
  const quote = useQuote({ addressId, coupon, points }, !!addressId);

  if (addresses.isLoading) return <Loading />;

  const issues = quote.data?.issues ?? [];
  // Pas encore de carte : cette commande donne-t-elle la carte Argent (16 000 FC payés) ?
  const card = loyalty.data?.card;
  const cdfRate = rates.CDF?.rate;
  let loyaltyHint: string | null = null;
  if (card && !card.legacy && card.card_status === 'none' && cdfRate && quote.data?.total_usd != null) {
    const totalCdf = Math.round(quote.data.total_usd * cdfRate);
    loyaltyHint = totalCdf >= card.enroll_min_cdf
      ? t('checkout.loyaltyEnroll')
      : t('checkout.loyaltyMissing', { amount: formatCdf(card.enroll_min_cdf - totalCdf, language), min: formatCdf(card.enroll_min_cdf, language) });
  }
  // On commande dans la devise affichée seulement si son taux existe.
  const orderCurrency = currency === 'USD' || rates[currency] ? currency : 'USD';

  const place = async () => {
    if (!addressId) return;
    setError(null);
    setPlacing(true);
    try {
      const res = unwrap(await supabase.rpc('place_order', {
        p_address_id: addressId,
        p_instructions: instructions || null,
        p_coupon_code: coupon,
        p_points: points,
        p_currency: orderCurrency,
      })) as { order_id: string; order_number: string };
      qc.invalidateQueries({ queryKey: qk.cart });
      qc.invalidateQueries({ queryKey: qk.orders });
      router.replace(`/payment/${res.order_id}`);
    } catch (e) {
      setError(errorMessage(e, t));
      quote.refetch();
    } finally {
      setPlacing(false);
    }
  };

  return (
    <Screen>
      <SectionHeader title={t('checkout.address')} />
      {(addresses.data ?? []).map((a) => (
        <Card key={a.id} onPress={() => setAddressId(a.id)} style={a.id === addressId ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
          <T weight="700">{a.label}</T>
          <T size="sm" muted>{[a.avenue && `${a.avenue} ${a.street_number ?? ''}`.trim(), a.quartier, a.commune].filter(Boolean).join(', ')}</T>
        </Card>
      ))}
      <Button title={t('checkout.addAddress')} variant="ghost" icon="add" onPress={() => router.push('/addresses/new')} />

      <Input label={t('checkout.instructions')} value={instructions} onChangeText={setInstructions} multiline maxLength={500} />

      <Row style={{ alignItems: 'flex-end' }}>
        <Input label={t('checkout.coupon')} value={couponInput} onChangeText={setCouponInput} autoCapitalize="characters" style={{ flex: 1 }} />
        <Button title={t('checkout.applyCoupon')} variant="secondary" onPress={() => setCoupon(couponInput.trim() || null)} />
      </Row>
      {usable > 0 ? (
        <Row>
          <Chip
            icon="star"
            active={usePoints}
            label={t('checkout.usePoints', { points: formatPoints(usable, language) })}
            onPress={() => setUsePoints((v) => !v)}
          />
        </Row>
      ) : null}

      {quote.isLoading ? <Loading /> : quote.data ? (
        <Card>
          {(quote.data.items ?? []).map((i) => (
            <Row key={i.inventory_id} style={{ justifyContent: 'space-between' }}>
              <T size="sm" style={{ flex: 1 }} numberOfLines={1}>{i.name} × {formatQty(Number(i.quantity), i.unit, t)}</T>
              <T size="sm">{money(i.line_total_usd)}</T>
            </Row>
          ))}
          <Divider />
          <Row style={{ justifyContent: 'space-between' }}><T>{t('cart.subtotal')}</T><T>{money(quote.data.subtotal_usd)}</T></Row>
          <Row style={{ justifyContent: 'space-between' }}><T>{t('checkout.deliveryFee')}</T><T>{money(quote.data.delivery_fee_usd)}</T></Row>
          {quote.data.distance_km != null ? <T size="xs" muted>{t('checkout.distance', { km: quote.data.distance_km })}</T> : null}
          {(quote.data.coupon_discount_usd ?? 0) > 0 ? (
            <Row style={{ justifyContent: 'space-between' }}><T>{t('checkout.couponDiscount')}</T><T color={colors.success}>− {money(quote.data.coupon_discount_usd)}</T></Row>
          ) : null}
          {(quote.data.loyalty_discount_usd ?? 0) > 0 ? (
            <Row style={{ justifyContent: 'space-between' }}><T>{t('checkout.loyaltyDiscount')}</T><T color={colors.success}>− {money(quote.data.loyalty_discount_usd)}</T></Row>
          ) : null}
          {(quote.data.tax_usd ?? 0) > 0 ? (
            <Row style={{ justifyContent: 'space-between' }}><T>{t('checkout.tax', { rate: formatRate(quote.data.tax_rate) })}</T><T>{money(quote.data.tax_usd)}</T></Row>
          ) : null}
          <Divider />
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="700">{t('checkout.total')}</T>
            <T size="xl" weight="700">{money(quote.data.total_usd)}</T>
          </Row>
        </Card>
      ) : null}

      {loyaltyHint ? <Notice tone="success" text={loyaltyHint} /> : null}
      {issues.map((i) => <Notice key={i} tone="warning" text={translateIssue(i, t)} />)}
      {error ? <Notice tone="danger" text={error} /> : null}
      <Notice text={t('checkout.noCash')} />
      <Button title={t('checkout.place')} icon="lock-closed-outline" loading={placing} disabled={!addressId || issues.length > 0 || quote.isFetching} onPress={place} />
    </Screen>
  );
}
