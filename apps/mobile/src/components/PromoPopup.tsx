import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useMarkNotificationsRead } from '@/hooks/data';
import { hasAppLink, openAppLink } from '@/lib/links';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import type { AppNotification } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';
import { T } from './ui';

// Promotions envoyées par l'administration (« Campagnes ») : grande carte avec la photo en entier,
// affichée dès qu'une promotion arrive pendant que l'application est ouverte, ou à l'ouverture suivante.

const listeners = new Set<(n: AppNotification) => void>();
/** Affiche une promotion reçue en direct (voir useLiveNotifications). */
export function showPromo(n: AppNotification): void {
  listeners.forEach((l) => l(n));
}

/** Délai avant de chercher une promotion non vue : l'animation d'ouverture (3 s) passe d'abord. */
const STARTUP_DELAY_MS = 4000;
/** Une promotion non vue est encore proposée à l'ouverture pendant 2 jours. */
const RECENT_MS = 48 * 3600_000;

export function PromoPopup() {
  const { session } = useAuth();
  const { colors, t } = useSettings();
  const { width } = useWindowDimensions();
  const markRead = useMarkNotificationsRead();
  const [promo, setPromo] = useState<AppNotification | null>(null);
  const [ratio, setRatio] = useState(2);
  const queue = useRef<AppNotification[]>([]);
  const shown = useRef(new Set<string>());
  const scale = useRef(new Animated.Value(0.92)).current;

  const present = (n: AppNotification) => {
    if (shown.current.has(n.id)) return;
    shown.current.add(n.id);
    if (!n.read_at) markRead.mutate([n.id]);
    setPromo((cur) => {
      if (cur) { queue.current.push(n); return cur; }
      return n;
    });
  };

  useEffect(() => {
    if (!session) return;
    listeners.add(present);
    // À l'ouverture : la dernière promotion pas encore vue (2 jours maximum).
    const h = setTimeout(async () => {
      const since = new Date(Date.now() - RECENT_MS).toISOString();
      const { data } = await supabase.from('notifications').select('*')
        .eq('user_id', session.user.id).eq('kind', 'promo').is('read_at', null).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(1);
      const n = (data?.[0] ?? null) as AppNotification | null;
      if (n && typeof n.data?.image_url === 'string') present(n);
    }, STARTUP_DELAY_MS);
    return () => { listeners.delete(present); clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!promo) return;
    setRatio(2);
    scale.setValue(0.92);
    Animated.timing(scale, { toValue: 1, duration: 220, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [promo, scale]);

  const close = () => setPromo(queue.current.shift() ?? null);
  if (!promo) return null;

  const d = promo.data ?? {};
  const image = typeof d.image_url === 'string' ? d.image_url : null;
  const link = hasAppLink(d.link_type, d.link_value);
  const cardW = Math.min(width - spacing.xl * 2, 420);
  // Photo en entier, à sa taille réelle (format conservé, entre portrait 4:5 et bandeau 2,4:1).
  const imgH = cardW / Math.min(2.4, Math.max(0.8, ratio));

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t('promo.close')}>
        <Animated.View style={{ width: cardW, transform: [{ scale }] }}>
          <Pressable style={[styles.card, { backgroundColor: colors.surface }]} onPress={() => undefined}>
            {image ? (
              <Pressable onPress={() => { if (link) { close(); openAppLink(d.link_type, d.link_value); } }} disabled={!link}>
                <Image
                  source={{ uri: image }}
                  style={{ width: cardW, height: imgH, backgroundColor: colors.surfaceAlt }}
                  contentFit="cover"
                  transition={200}
                  onLoad={(e) => { if (e.source.width && e.source.height) setRatio(e.source.width / e.source.height); }}
                  accessibilityLabel={promo.title}
                />
              </Pressable>
            ) : null}
            <View style={styles.text}>
              <View style={styles.tag}>
                <Ionicons name="pricetags" size={13} color={colors.primary} />
                <T size="xs" weight="800" color={colors.primary}>{t('promo.label').toUpperCase()}</T>
              </View>
              <T size="lg" weight="800">{promo.title}</T>
              {promo.body ? <T muted>{promo.body}</T> : null}
              {link ? (
                <Pressable onPress={() => { close(); openAppLink(d.link_type, d.link_value); }} accessibilityRole="button"
                  style={({ pressed }) => [styles.cta, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
                  <T weight="800" color="#FFFFFF">{t('promo.cta')}</T>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>
          </Pressable>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('promo.close')} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10, 12, 16, 0.62)', alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  text: { padding: spacing.lg, gap: spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cta: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, paddingVertical: 13 },
  closeBtn: {
    position: 'absolute', top: -14, right: -10, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(20, 22, 28, 0.85)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFFFFF',
  },
});
