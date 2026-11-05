import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, ErrorState, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { qk, useOrder } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

type Method = 'mpesa' | 'orange_money' | 'airtel_money' | 'afrimoney' | 'visa' | 'mastercard' | 'bank_transfer' | 'other';
const MOBILE_MONEY: Method[] = ['mpesa', 'orange_money', 'airtel_money', 'afrimoney'];

export default function Payment() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t, money } = useSettings();
  const qc = useQueryClient();
  const order = useOrder(orderId);
  const config = useQuery({
    queryKey: ['payments-config'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'payments').maybeSingle();
      return (data?.value ?? { enabled_methods: [] }) as { enabled_methods: Method[]; provider: string | null };
    },
  });
  const [method, setMethod] = useState<Method | null>(null);
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<{ tone: 'info' | 'danger' | 'success' | 'warning'; text: string } | null>(null);

  // La confirmation vient UNIQUEMENT du serveur (webhook du prestataire) : on écoute la commande.
  useEffect(() => {
    const ch = supabase
      .channel(`pay-${orderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => qc.invalidateQueries({ queryKey: qk.order(orderId) }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orderId, qc]);

  if (order.isLoading || config.isLoading) return <Loading />;
  if (!order.data?.order) return <ErrorState message={t('common.error')} onRetry={order.refetch} />;
  const o = order.data.order;
  const methods = config.data?.enabled_methods ?? [];

  if (o.payment_status === 'succeeded') {
    return (
      <Screen>
        <Notice tone="success" text={t('payment.success')} />
        <Button title={t('orders.details')} onPress={() => router.replace(`/order/${o.id}`)} />
      </Screen>
    );
  }

  const pay = async () => {
    if (!method) return;
    setSending(true);
    setInfo(null);
    const { data, error } = await supabase.functions.invoke('payments-initiate', {
      body: { order_id: o.id, method, payer_phone: MOBILE_MONEY.includes(method) ? phone.replace(/\s/g, '') : undefined },
    });
    setSending(false);
    if (error) {
      let code: string | undefined;
      try { code = (await (error as { context?: Response }).context?.json())?.error; } catch { /* ignore */ }
      setInfo({ tone: code === 'PAYMENT_PROVIDER_NOT_CONFIGURED' ? 'warning' : 'danger', text: code ? errorMessage({ message: code }, t) : errorMessage(error, t) });
      return;
    }
    if (data?.redirect_url) {
      // Paiement carte : page sécurisée du prestataire (aucune donnée de carte ne transite par l'app).
      await Linking.openURL(String(data.redirect_url));
    }
    setInfo({ tone: 'info', text: t('payment.pending') });
  };

  return (
    <Screen>
      <Card>
        <T muted>{t('orders.number', { n: o.order_number })}</T>
        <T size="xxl" weight="700">{money(o.total_usd)}</T>
      </Card>

      {methods.length === 0 ? (
        <Notice tone="warning" text={t('payment.notConfigured')} />
      ) : (
        <>
          <T weight="700">{t('payment.choose')}</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {methods.map((m) => <Chip key={m} label={t(`payment.${m}`)} active={method === m} onPress={() => setMethod(m)} />)}
          </Row>
          {method && MOBILE_MONEY.includes(method) ? (
            <Input label={t('payment.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+243 8x xxx xxxx" />
          ) : null}
          <Button
            title={t('payment.pay', { amount: money(o.total_usd) })}
            icon="lock-closed-outline"
            loading={sending}
            disabled={!method || (MOBILE_MONEY.includes(method) && phone.replace(/\D/g, '').length < 9)}
            onPress={pay}
          />
        </>
      )}
      {info ? <Notice tone={info.tone} text={info.text} /> : null}
      <Notice text={t('checkout.noCash')} />
      <Button title={t('orders.details')} variant="ghost" onPress={() => router.replace(`/order/${o.id}`)} />
    </Screen>
  );
}
