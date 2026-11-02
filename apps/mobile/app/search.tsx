import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ProductGrid } from '@/components/product';
import { Button, Chip, Input, Loading, Row, Screen, SectionHeader, T } from '@/components/ui';
import { useCatalog } from '@/hooks/data';
import { supabase, unwrap } from '@/lib/supabase';
import type { CatalogItem } from '@/lib/types';
import { spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';

export default function Search() {
  const params = useLocalSearchParams<{ promo?: string; q?: string }>();
  const { t, selectedStoreId } = useSettings();
  const [text, setText] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const promoOnly = params.promo === '1';

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
        <Chip label={t('search.inStockOnly')} icon="checkmark" active={inStockOnly} onPress={() => setInStockOnly((v) => !v)} />
      </Row>
      {permission && !permission.granted && !permission.canAskAgain ? <T size="sm" muted>{t('search.cameraDenied')}</T> : null}

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
