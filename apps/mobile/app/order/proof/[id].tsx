import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, Input, Loading, Notice, Row, Screen, T } from '@/components/ui';
import { useOrder } from '@/hooks/data';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n';
import { supabase, unwrap } from '@/lib/supabase';
import { spacing } from '@/lib/theme';
import { pickImage, randomName, uploadFile, type PickedImage } from '@/lib/upload';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const METHODS = ['bank_transfer', 'mpesa', 'orange_money', 'airtel_money', 'afrimoney', 'other'] as const;

export default function PaymentProof() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, money, language, colors } = useSettings();
  const { session } = useAuth();
  const qc = useQueryClient();
  const order = useOrder(id);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['payment-proofs', id],
    queryFn: async () => unwrap(await supabase.from('payment_proofs').select('id, status, method, reference, review_note, created_at')
      .eq('order_id', id).order('created_at', { ascending: false })) as { id: string; status: string; method: string; reference: string | null; review_note: string | null; created_at: string }[],
  });

  if (order.isLoading || !session) return <Loading />;
  const o = order.data?.order;
  if (!o) return <Notice tone="danger" text={t('orders.lookupNotFound')} />;
  const pending = history.data?.some((p) => p.status === 'pending');

  const choose = async (source: 'camera' | 'gallery') => {
    const img = await pickImage(source);
    if (img === 'denied') return setError(t('search.cameraDenied'));
    if (img) setFile(img);
  };

  const submit = async () => {
    setError(null);
    if (!file) return setError(t('proof.missingFile'));
    setBusy(true);
    try {
      const path = await uploadFile('payment-proofs', `${session.user.id}/${o.id}/${randomName(file.ext)}`, file);
      unwrap(await supabase.from('payment_proofs').insert({
        order_id: o.id, customer_id: session.user.id, storage_path: path, method,
        reference: reference.trim() || null, note: note.trim() || null,
      }));
      qc.invalidateQueries({ queryKey: ['payment-proofs'] });
      Alert.alert(t('proof.title'), t('proof.sent'));
      router.back();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T weight="700">{o.order_number}</T>
          <T weight="700">{money(o.total_usd)}</T>
        </Row>
        <T size="sm" muted>{t(`payStatus.${o.payment_status}` as TranslationKey)}</T>
      </Card>
      <Notice text={t('proof.help')} />

      {history.data?.map((p) => (
        <Card key={p.id}>
          <T weight="600" color={p.status === 'approved' ? colors.success : p.status === 'rejected' ? colors.danger : colors.warning}>
            {t(`proof.status.${p.status}` as TranslationKey)}
          </T>
          <T size="xs" muted>{t(`payment.${p.method}` as TranslationKey)}{p.reference ? ` · ${p.reference}` : ''} · {formatDate(p.created_at, language)}</T>
          {p.review_note ? <T size="sm">{p.review_note}</T> : null}
        </Card>
      ))}

      {pending || o.payment_status === 'succeeded' ? null : (
        <>
          <T size="sm" muted>{t('proof.method')}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {METHODS.map((m) => <Chip key={m} label={t(`payment.${m}` as TranslationKey)} active={method === m} onPress={() => setMethod(m)} />)}
          </ScrollView>
          <Input label={t('proof.reference')} value={reference} onChangeText={setReference} maxLength={120} autoCapitalize="characters" />
          <Input label={`${t('proof.note')} (${t('common.optional')})`} value={note} onChangeText={setNote} multiline maxLength={1000} />
          <T size="sm" muted>{t('proof.file')}</T>
          {file ? <Image source={{ uri: file.uri }} style={{ width: '100%', height: 220, borderRadius: 12 }} contentFit="contain" /> : null}
          <Row>
            <Button title={t('common.camera')} icon="camera-outline" variant="secondary" onPress={() => choose('camera')} />
            <Button title={t('common.gallery')} icon="images-outline" variant="secondary" onPress={() => choose('gallery')} />
          </Row>
          {error ? <Notice tone="danger" text={error} /> : null}
          <Button title={t('proof.submit')} icon="cloud-upload-outline" loading={busy} onPress={submit} />
        </>
      )}
    </Screen>
  );
}
