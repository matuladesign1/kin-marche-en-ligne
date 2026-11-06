import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ProductGrid } from '@/components/product';
import { Button, Chip, EmptyState, Input, Loading, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { useCatalog } from '@/hooks/data';
import { supabase, unwrap } from '@/lib/supabase';
import type { CatalogItem } from '@/lib/types';
import { radius, spacing } from '@/lib/theme';
import type { Language } from '@/lib/types';
import { findSimilarProducts, photoBlurhash } from '@/lib/visualSearch';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Langues de reconnaissance vocale. Le lingala dépend du moteur installé sur le téléphone :
// s'il n'est pas pris en charge, on bascule sur le français et on le signale.
const SPEECH_LANG: Record<Language, string> = { fr: 'fr-FR', en: 'en-US', sw: 'sw-KE', ln: 'ln-CD' };

// Google Cloud Vision (texte et marques de l'emballage) complète la recherche par photo quand il est activé
// sur le projet Google ; sinon il n'est plus appelé de la session.
let visionAvailable: boolean | null = null;

export default function Search() {
  const params = useLocalSearchParams<{ promo?: string; q?: string; mode?: string }>();
  const { t, selectedStoreId, language, colors } = useSettings();
  const { session } = useAuth();
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
  const [visual, setVisual] = useState<{ photo: string; terms: string[]; items: CatalogItem[] } | null>(null);
  const [visualBusy, setVisualBusy] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);
  // Recherche par photo : la page ne montre que la photo et les articles similaires.
  const [photoMode, setPhotoMode] = useState(params.mode === 'photo');

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

  const visionSearch = async (base64?: string | null) => {
    if (!base64 || !session || visionAvailable === false) return null;
    try {
      const { data, error } = await supabase.functions.invoke('image-search', { body: { image_base64: base64, store_id: selectedStoreId } });
      if (error) {
        let code: string | undefined;
        try { code = (await (error as { context?: Response }).context?.json())?.error; } catch { /* ignore */ }
        if (code === 'VISION_API_ERROR' || code === 'VISION_NOT_CONFIGURED') visionAvailable = false;
        return null;
      }
      visionAvailable = true;
      return data as { terms: string[]; items: CatalogItem[] };
    } catch {
      return null;
    }
  };

  // Recherche par photo similaire : empreinte de la photo calculée sur le téléphone, produits classés
  // du plus ressemblant au moins ressemblant (voir lib/visualSearch). Vision s'y ajoute s'il est activé.
  const runVisual = async (uri: string, base64?: string | null) => {
    setPhotoMode(true);
    setVisualBusy(true);
    setVisualError(null);
    setVisual(null);
    try {
      const hash = await photoBlurhash(uri);
      if (!hash) throw new Error('NO_HASH');
      const [similar, vision] = await Promise.all([
        findSimilarProducts(hash, { storeId: selectedStoreId }),
        visionSearch(base64),
      ]);
      const seen = new Set<string>();
      const items: CatalogItem[] = [];
      for (const it of [...(vision?.items ?? []).slice(0, 8), ...similar]) {
        if (seen.has(it.product_id)) continue;
        seen.add(it.product_id);
        items.push(it);
      }
      setVisual({ photo: uri, terms: vision?.terms ?? [], items });
    } catch {
      setVisualError(t('search.photoError'));
    } finally {
      setVisualBusy(false);
    }
  };

  const searchByPhoto = async (fromCamera: boolean) => {
    // Recadrage carré sur le produit : la comparaison porte sur le produit, pas sur le décor.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, base64: visionAvailable !== false, allowsEditing: true, aspect: [1, 1] };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.canceled ? null : res.assets[0];
    if (asset) runVisual(asset.uri, asset.base64);
    else if (!visual) setPhotoMode(false);   // photo annulée : retour à la recherche normale
  };

  // Recherche par vidéo : on analyse une image extraite de la vidéo (1re seconde).
  const searchByVideo = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (res.canceled || !res.assets[0]) return;
    setVisualBusy(true);
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(res.assets[0].uri, { time: 1000, quality: 0.5 });
      const b64 = visionAvailable === false ? null : await FileSystem.readAsStringAsync(thumb.uri, { encoding: FileSystem.EncodingType.Base64 });
      await runVisual(thumb.uri, b64);
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

  // Ouverture directe depuis la barre de recherche de l'accueil (photo, voix, code-barres).
  const autoMode = useRef(false);
  useEffect(() => {
    if (autoMode.current || !params.mode) return;
    autoMode.current = true;
    if (params.mode === 'photo') searchByPhoto(true);
    else if (params.mode === 'voice') startVoice();
    else if (params.mode === 'scan') openScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.mode]);

  const onScanned = (r: BarcodeScanningResult) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScanning(false);
    setText(r.data);
    setQuery(r.data);
  };

  if (photoMode) {
    return (
      <Screen>
        {visualBusy ? <Loading label={t('search.photoAnalyzing')} /> : null}
        {visualError ? <Notice tone="warning" text={visualError} /> : null}
        {visual ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.photoHead, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Image source={{ uri: visual.photo }} style={[styles.photoThumb, { backgroundColor: colors.surfaceAlt }]} contentFit="cover"
                accessibilityLabel={t('search.yourPhoto')} />
              <View style={{ flex: 1, gap: 2 }}>
                <T weight="800">{t('search.photoResults')}</T>
                {visual.items.length ? <T size="xs" muted>{t('search.photoSimilarHint')}</T> : null}
                {visual.terms.length ? <T size="xs" muted numberOfLines={2}>{t('search.photoTerms', { terms: visual.terms.slice(0, 8).join(', ') })}</T> : null}
              </View>
            </View>
            {visual.items.length ? <ProductGrid items={visual.items} emptyMessage="" /> : <EmptyState icon="images-outline" message={t('search.photoNone')} />}
          </View>
        ) : null}
        {!visualBusy ? (
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label={t('search.photoAgain')} icon="camera-outline" onPress={() => searchByPhoto(true)} />
            <Chip label={t('search.gallery')} icon="image-outline" onPress={() => searchByPhoto(false)} />
            <Chip label={t('search.textSearch')} icon="search-outline" onPress={() => { setVisual(null); setVisualError(null); setPhotoMode(false); }} />
          </Row>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <Input value={text} onChangeText={setText} placeholder={t('home.searchPlaceholder')} autoFocus={!promoOnly && !params.mode} returnKeyType="search" clearButtonMode="while-editing" />
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

      {results.isLoading ? <Loading /> : (query || promoOnly) ? (
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

const styles = StyleSheet.create({
  photoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  photoThumb: { width: 64, height: 64, borderRadius: radius.md },
});
