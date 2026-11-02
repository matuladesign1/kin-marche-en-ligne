import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ProductGrid } from '@/components/product';
import { Button, Chip, Input, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { useCatalog } from '@/hooks/data';
import { supabase, unwrap } from '@/lib/supabase';
import type { CatalogItem } from '@/lib/types';
import { spacing } from '@/lib/theme';
import type { Language } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

// Langues de reconnaissance vocale. Le lingala dépend du moteur installé sur le téléphone :
// s'il n'est pas pris en charge, on bascule sur le français et on le signale.
const SPEECH_LANG: Record<Language, string> = { fr: 'fr-FR', en: 'en-US', sw: 'sw-KE', ln: 'ln-CD' };

export default function Search() {
  const params = useLocalSearchParams<{ promo?: string; q?: string }>();
  const { t, selectedStoreId, language } = useSettings();
  const [text, setText] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const promoOnly = params.promo === '1';
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const triedFallback = useRef(false);
  const [visual, setVisual] = useState<{ terms: string[]; items: CatalogItem[] } | null>(null);
  const [visualBusy, setVisualBusy] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    setText(text);
    if (e.isFinal) setQuery(text.trim());
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    if (e.error === 'language-not-supported' && !triedFallback.current) {
      triedFallback.current = true;
      setVoiceNote(t('search.voiceFallback'));
      ExpoSpeechRecognitionModule.start({ lang: 'fr-FR', interimResults: true });
      setListening(true);
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      setVoiceNote(t('search.voiceError'));
    }
  });

  const startVoice = async () => {
    if (listening) { ExpoSpeechRecognitionModule.stop(); return; }
    setVoiceNote(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { setVoiceNote(t('search.voiceDenied')); return; }
    triedFallback.current = false;
    setVisual(null);
    ExpoSpeechRecognitionModule.start({ lang: SPEECH_LANG[language], interimResults: true, continuous: false });
    setListening(true);
  };

  const runVisual = async (base64: string) => {
    setVisualBusy(true);
    setVisualError(null);
    setVisual(null);
    const { data, error } = await supabase.functions.invoke('image-search', { body: { image_base64: base64, store_id: selectedStoreId } });
    setVisualBusy(false);
    if (error) {
      let code: string | undefined;
      try { code = (await (error as { context?: Response }).context?.json())?.error; } catch { /* ignore */ }
      setVisualError(code === 'VISION_API_ERROR' || code === 'VISION_NOT_CONFIGURED' ? t('search.photoNotEnabled') : t('common.error'));
      return;
    }
    setVisual(data as { terms: string[]; items: CatalogItem[] });
  };

  const searchByPhoto = async (fromCamera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.4, base64: true };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]?.base64) runVisual(res.assets[0].base64);
  };

  // Recherche par vidéo : on analyse une image extraite de la vidéo (1re seconde).
  const searchByVideo = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (res.canceled || !res.assets[0]) return;
    setVisualBusy(true);
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(res.assets[0].uri, { time: 1000, quality: 0.5 });
      const b64 = await FileSystem.readAsStringAsync(thumb.uri, { encoding: FileSystem.EncodingType.Base64 });
      await runVisual(b64);
    } catch {
      setVisualBusy(false);
      setVisualError(t('common.error'));
    }
  };

  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(h);
  }, [text]);

  const results = useCatalog({ query: query || null, storeId: selectedStoreId, inStockOnly, limit: 60 }, !!query || promoOnly);
  const list = (results.data ?? []).filter((i) => !promoOnly || i.on_promo);

  // Aucun résultat exact : on propose des produits de la même catégorie que le meilleur résultat partiel.
  const alternatives = useQuery({
    queryKey: ['alternatives', query],
    enabled: !!query && results.isFetched && list.length === 0,
    queryFn: async () => {
      const firstWord = query.split(/\s+/).find((w) => w.length >= 3);
      if (!firstWord) return [] as CatalogItem[];
      const partial = unwrap(await supabase.rpc('search_catalog', { p_query: firstWord, p_limit: 1 })) as CatalogItem[];
      const categoryId = partial[0]?.category_id;
      if (!categoryId) return partial;
      return unwrap(await supabase.rpc('search_catalog', { p_category_id: categoryId, p_in_stock_only: true, p_limit: 12 })) as CatalogItem[];
    },
  });

  const openScanner = async () => {
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) return;
    }
    scannedRef.current = false;
    setScanning(true);
  };

  const onScanned = (r: BarcodeScanningResult) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScanning(false);
    setText(r.data);
    setQuery(r.data);
  };

  return (
    <Screen>
      <Input value={text} onChangeText={setText} placeholder={t('home.searchPlaceholder')} autoFocus={!promoOnly} returnKeyType="search" clearButtonMode="while-editing" />
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={t('search.scan')} icon="barcode-outline" onPress={openScanner} />
        <Chip label={listening ? t('search.listening') : t('search.voice')} icon={listening ? 'stop-circle-outline' : 'mic-outline'} active={listening} onPress={startVoice} />
        <Chip label={t('search.photo')} icon="camera-outline" onPress={() => searchByPhoto(true)} />
        <Chip label={t('search.gallery')} icon="image-outline" onPress={() => searchByPhoto(false)} />
        <Chip label={t('search.video')} icon="videocam-outline" onPress={searchByVideo} />
        <Chip label={t('search.inStockOnly')} icon="checkmark" active={inStockOnly} onPress={() => setInStockOnly((v) => !v)} />
      </Row>
      {permission && !permission.granted && !permission.canAskAgain ? <T size="sm" muted>{t('search.cameraDenied')}</T> : null}

      {voiceNote ? <Notice tone="warning" text={voiceNote} /> : null}
      {visualError ? <Notice tone="warning" text={visualError} /> : null}
      {visualBusy ? <Loading /> : null}
      {visual ? (
        <View style={{ gap: spacing.md }}>
          <SectionHeader title={t('search.photoResults')} />
          {visual.terms.length ? <T size="xs" muted>{t('search.photoTerms', { terms: visual.terms.slice(0, 8).join(', ') })}</T> : null}
          <ProductGrid items={visual.items} emptyMessage={t('search.photoNone')} />
        </View>
      ) : null}

      {visual ? null : results.isLoading ? <Loading /> : (query || promoOnly) ? (
        list.length > 0 ? <ProductGrid items={list} emptyMessage="" /> : (
          <View style={{ gap: spacing.md }}>
            <T muted>{t('search.noResult', { q: query })}</T>
            {alternatives.data && alternatives.data.length > 0 ? (
              <>
                <SectionHeader title={t('search.alternatives')} />
                <ProductGrid items={alternatives.data} emptyMessage="" />
              </>
            ) : null}
          </View>
        )
      ) : null}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
            onBarcodeScanned={onScanned}
          />
          <View style={{ position: 'absolute', bottom: 40, left: 16, right: 16 }}>
            <Button title={t('common.close')} variant="secondary" onPress={() => setScanning(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
