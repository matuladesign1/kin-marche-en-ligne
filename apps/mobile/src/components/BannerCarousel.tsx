import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Linking, Pressable, StyleSheet, View, type FlatList } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { localized } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';
import { T } from './ui';

export interface Banner {
  id: string;
  title: string | null;
  title_i18n: Record<string, string> | null;
  image_url: string;
  media_type: 'image' | 'video';
  video_url: string | null;
  link_type: string | null;
  link_value: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

// Toutes les bannières ont exactement le même format : 1200 × 448 px (100 ppp), affichées en entier, sans recadrage.
export const BANNER_RATIO = 1200 / 448;
const WIDTH = Dimensions.get('window').width - spacing.lg * 2;
const HEIGHT = Math.round(WIDTH / BANNER_RATIO);
const IMAGE_MS = 5000;
const VIDEO_MS = 9000;

export function useBanners() {
  return useQuery({
    queryKey: ['banners'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('banners')
        .select('id, title, title_i18n, image_url, media_type, video_url, link_type, link_value, starts_at, ends_at')
        .eq('is_active', true).order('sort_order').order('created_at', { ascending: false });
      const now = Date.now();
      return ((data ?? []) as Banner[]).filter((b) =>
        (!b.starts_at || new Date(b.starts_at).getTime() <= now) && (!b.ends_at || new Date(b.ends_at).getTime() > now));
    },
  });
}

function openBanner(b: Banner) {
  if (!b.link_value && b.link_type !== 'promotion') return;
  switch (b.link_type) {
    case 'product': router.push(`/product/${b.link_value}`); break;
    case 'category': router.push(`/category/${b.link_value}`); break;
    case 'promotion': router.push('/search?promo=1'); break;
    case 'url': if (b.link_value && /^https:\/\//.test(b.link_value)) Linking.openURL(b.link_value); break;
    default: break;
  }
}

function VideoSlide({ uri, poster, active }: { uri: string; poster: string; active: boolean }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') setReady(true); });
    return () => sub.remove();
  }, [player]);
  useEffect(() => {
    if (active) player.play(); else player.pause();
  }, [active, player]);
  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      {!ready ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    </>
  );
}

/** Bannière publicitaire : défilement automatique, effet de profondeur et indicateurs de progression. */
export function BannerCarousel() {
  const { language, colors } = useSettings();
  const banners = useBanners();
  const list = banners.data ?? [];
  const scrollX = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<Banner>>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const step = WIDTH + spacing.sm;

  const goTo = useCallback((i: number) => {
    if (!list.length) return;
    const next = (i + list.length) % list.length;
    listRef.current?.scrollToOffset({ offset: next * step, animated: true });
    setIndex(next);
  }, [list.length, step]);

  // Avance automatique : la barre de l'élément actif se remplit, puis bannière suivante.
  useEffect(() => {
    if (list.length < 2 || paused) return;
    const current = list[index];
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1, duration: current?.media_type === 'video' ? VIDEO_MS : IMAGE_MS, easing: Easing.linear, useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) goTo(index + 1); });
    return () => anim.stop();
  }, [index, paused, list, progress, goTo]);

  if (!list.length) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <Animated.FlatList
        ref={listRef as never}
        data={list}
        horizontal
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setPaused(true)}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / step));
          setPaused(false);
        }}
        renderItem={({ item, index: i }) => {
          const inputRange = [(i - 1) * step, i * step, (i + 1) * step];
          const scale = scrollX.interpolate({ inputRange, outputRange: [0.92, 1, 0.92], extrapolate: 'clamp' });
          const textY = scrollX.interpolate({ inputRange, outputRange: [24, 0, 24], extrapolate: 'clamp' });
          const textOpacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
          const title = localized(item.title_i18n ?? undefined, language, item.title ?? '');
          return (
            <Pressable onPress={() => openBanner(item)} accessibilityRole="imagebutton" accessibilityLabel={title || undefined}>
              <Animated.View style={[styles.slide, { transform: [{ scale }], backgroundColor: colors.surfaceAlt }]}>
                {/* Image au format exact du cadre (1200 × 448) : rien n'est coupé. */}
                {item.media_type === 'video' && item.video_url ? (
                  <VideoSlide uri={item.video_url} poster={item.image_url} active={i === index} />
                ) : (
                  <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
                )}
                {title ? (
                  <>
                    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
                      <Defs>
                        <LinearGradient id={`g${item.id}`} x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0.45" stopColor="#000000" stopOpacity="0" />
                          <Stop offset="1" stopColor="#000000" stopOpacity="0.62" />
                        </LinearGradient>
                      </Defs>
                      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#g${item.id})`} />
                    </Svg>
                    <Animated.View style={[styles.caption, { opacity: textOpacity, transform: [{ translateY: textY }] }]}>
                      <View style={[styles.accentBar, { backgroundColor: colors.primary }]} />
                      <T size="lg" weight="800" color="#FFFFFF" numberOfLines={2} style={{ flex: 1 }}>{title}</T>
                    </Animated.View>
                  </>
                ) : null}
              </Animated.View>
            </Pressable>
          );
        }}
      />
      {list.length > 1 ? (
        <View style={styles.bars}>
          {list.map((b, i) => (
            <Pressable key={b.id} onPress={() => goTo(i)} hitSlop={8} style={[styles.bar, { backgroundColor: colors.border, width: i === index ? 28 : 14 }]}>
              {i < index ? <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }]} /> : null}
              {i === index ? (
                <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary, transformOrigin: 'left', transform: [{ scaleX: paused ? 1 : progress }] }]} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { width: WIDTH, height: HEIGHT, borderRadius: radius.lg, overflow: 'hidden' },
  caption: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  accentBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  bars: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
