import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Stars } from '@/components/Stars';
import { Button, Card, Input, Loading, Notice, Screen, SectionHeader, T } from '@/components/ui';
import { useOrder } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

interface Draft { rating: number; comment: string }

export default function ReviewOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const order = useOrder(id);
  const [store, setStore] = useState<Draft>({ rating: 0, comment: '' });
  const [delivery, setDelivery] = useState<Draft>({ rating: 0, comment: '' });
  const [products, setProducts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (order.isLoading || !session) return <Loading />;
  const o = order.data?.order;
  if (!o) return <Notice tone="danger" text={t('orders.lookupNotFound')} />;
  // Un produit peut apparaître sur plusieurs lignes : une seule note par produit.
  const items = Array.from(new Map((order.data?.items ?? []).filter((i) => i.product_id).map((i) => [i.product_id, i] as const)).values());

  const submit = async () => {
    setError(null);
    const rows: Record<string, unknown>[] = [];
    const base = { order_id: o.id, author_id: session.user.id };
    if (store.rating) rows.push({ ...base, target_type: 'store', store_id: o.store_id, rating: store.rating, comment: store.comment.trim() || null });
    if (delivery.rating) rows.push({ ...base, target_type: 'delivery', rating: delivery.rating, comment: delivery.comment.trim() || null });
    for (const [pid, d] of Object.entries(products)) {
      if (d.rating) rows.push({ ...base, target_type: 'product', product_id: pid, rating: d.rating, comment: d.comment.trim() || null });
    }
    if (!rows.length) return setError(t('review.needOne'));
    setBusy(true);
    try {
      unwrap(await supabase.from('reviews').insert(rows));
      qc.invalidateQueries({ queryKey: ['orders-to-review'] });
      Alert.alert(t('review.title'), t('review.sent'));
      router.back();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const block = (title: string, d: Draft, set: (d: Draft) => void) => (
    <Card>
      <T weight="700">{title}</T>
      <Stars value={d.rating} onChange={(rating) => set({ ...d, rating })} size={30} />
      <Input value={d.comment} onChangeText={(comment) => set({ ...d, comment })} placeholder={t('review.comment')} multiline maxLength={1000} />
    </Card>
  );

  return (
    <Screen>
      <T size="lg" weight="700">{o.order_number}</T>
      {block(`${t('review.store')} · ${o.stores?.name ?? ''}`, store, setStore)}
      {block(t('review.delivery'), delivery, setDelivery)}
      {items.length ? <SectionHeader title={t('review.products')} /> : null}
      {items.map((i) => block(i.product_name, products[i.product_id!] ?? { rating: 0, comment: '' },
        (d) => setProducts((p) => ({ ...p, [i.product_id!]: d }))))}
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button title={t('review.submit')} icon="send-outline" loading={busy} onPress={submit} />
    </Screen>
  );
}
