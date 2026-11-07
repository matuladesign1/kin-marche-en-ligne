import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { Avatar } from '@/components/kit';
import { Row, T } from '@/components/ui';
import { usePastryChefCard, useSignedUrl } from '@/hooks/pastry';
import { formatDate } from '@/lib/format';
import { CATEGORY_LOOK, PASTRY, PASTRY_FLOW, TONE_COLOR, desiredLabel, statusLabel, statusTone } from '@/lib/pastry';
import { radius, spacing } from '@/lib/theme';
import type { PastryCategory, PastryOrder, PastryStatus } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

// Éléments communs de la pâtisserie (client et pâtissier) : icône de catégorie, statut, parcours,
// pâtissier, photo de référence et détail de la demande.

export function CategoryIcon({ category, size = 44 }: { category: PastryCategory; size?: number }) {
  const look = CATEGORY_LOOK[category] ?? CATEGORY_LOOK.other;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${look.tint}1F`, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={look.icon} size={Math.round(size * 0.52)} color={look.tint} />
    </View>
  );
}

export function PastryStatusPill({ status }: { status: PastryStatus }) {
  const { t } = useSettings();
  const c = TONE_COLOR[statusTone(status)];
  return (
    <View style={[styles.pill, { backgroundColor: `${c}1F` }]}>
      <View style={[styles.pillDot, { backgroundColor: c }]} />
      <T size="xs" weight="800" color={c} numberOfLines={1}>{statusLabel(status, t)}</T>
    </View>
  );
}

/** Ligne d'une demande dans une liste (client ou pâtissier). */
export function PastryOrderRow({ order, subtitle, right, onPress, highlight }: {
  order: PastryOrder; subtitle?: string; right?: ReactNode; onPress: () => void; highlight?: string;
}) {
  const { t, colors, language, money } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, borderColor: highlight ?? colors.border, opacity: pressed ? 0.9 : 1 }]}>
      <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
        <CategoryIcon category={order.category} />
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="800" numberOfLines={1}>{order.cake_type}</T>
          <T size="xs" muted numberOfLines={1}>{subtitle ?? `${order.request_number ?? ''} · ${order.stores?.name ?? ''}`}</T>
        </View>
        <PastryStatusPill status={order.status} />
      </Row>
      <Row gap={spacing.md} style={{ flexWrap: 'wrap' }}>
        <Row gap={4}>
          <Ionicons name={order.desired_at ? 'calendar-outline' : 'flash-outline'} size={14} color={colors.textMuted} />
          <T size="xs" weight="600">{desiredLabel(order.desired_at, language, t)}</T>
        </Row>
        {order.quoted_price_usd != null ? (
          <Row gap={4}>
            <Ionicons name="pricetag-outline" size={14} color={colors.textMuted} />
            <T size="xs" weight="700">{money(order.quoted_price_usd)}</T>
          </Row>
        ) : null}
        <View style={{ flex: 1 }} />
        {right}
      </Row>
    </Pressable>
  );
}

/** Parcours de la demande, vu par le client : chaque étape franchie est cochée. */
export function PastryTimeline({ order }: { order: PastryOrder }) {
  const { t, colors, language } = useSettings();
  const stopped = order.status === 'rejected' || order.status === 'cancelled';
  const reached = PASTRY_FLOW.indexOf(order.status);
  const lastIndex = stopped
    ? (order.accepted_at ? 2 : order.quoted_at ? 1 : 0)
    : reached;
  const times: Partial<Record<PastryStatus, string | null>> = {
    submitted: order.created_at, quoted: order.quoted_at, accepted: order.accepted_at,
  };
  const steps = stopped ? PASTRY_FLOW.slice(0, lastIndex + 1) : PASTRY_FLOW;
  return (
    <View style={{ gap: 0 }}>
      {steps.map((s, i) => {
        const done = i <= lastIndex;
        const current = i === lastIndex && !stopped && order.status !== 'delivered';
        const color = done ? (current ? PASTRY.raspberry : colors.success) : colors.border;
        const time = times[s];
        return (
          <View key={s} style={styles.tlRow}>
            <View style={styles.tlRail}>
              <View style={[styles.tlDot, { backgroundColor: done ? color : colors.surface, borderColor: color }]}>
                {done && !current ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
              </View>
              {i < steps.length - 1 || stopped ? <View style={[styles.tlLine, { backgroundColor: i < lastIndex ? colors.success : colors.border }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: spacing.md }}>
              <T weight={current ? '800' : done ? '600' : '400'} muted={!done}>{t(`pastry.flow.${s}` as 'pastry.flow.submitted')}</T>
              {time && done ? <T size="xs" muted>{formatDate(time, language)}</T> : null}
            </View>
          </View>
        );
      })}
      {stopped ? (
        <View style={styles.tlRow}>
          <View style={styles.tlRail}>
            <View style={[styles.tlDot, { backgroundColor: colors.danger, borderColor: colors.danger }]}>
              <Ionicons name="close" size={12} color="#FFFFFF" />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <T weight="800" color={colors.danger}>{statusLabel(order.status, t)}</T>
            {order.rejected_at || order.cancelled_at ? <T size="xs" muted>{formatDate(order.rejected_at ?? order.cancelled_at, language)}</T> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Pâtissier en charge (carte publique : photo, nom, badge certifié, expérience). */
export function ChefCard({ chefId }: { chefId: string | null | undefined }) {
  const { t, colors } = useSettings();
  const card = usePastryChefCard(chefId);
  const c = card.data;
  if (!chefId || !c) return null;
  return (
    <View style={[styles.chef, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View>
        <Avatar uri={c.avatar_url} name={c.name} size={56} />
        <View style={[styles.hat, { backgroundColor: PASTRY.choco }]}>
          <MaterialCommunityIcons name="chef-hat" size={13} color="#FFFFFF" />
        </View>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <T size="xs" muted>{t('pastry.yourChef')}</T>
        <Row gap={6}>
          <T weight="800" size="lg" numberOfLines={1} style={{ flexShrink: 1 }}>{c.name ?? t('pastry.chefLabel')}</T>
          {c.certified ? <CertifiedBadge size={18} label={t('pastry.certifiedChef')} /> : null}
        </Row>
        <T size="xs" muted numberOfLines={2}>
          {[c.years_experience ? t('pastry.chefYears', { n: c.years_experience }) : null,
            c.orders_done ? t('pastry.chefDone', { n: c.orders_done }) : null].filter(Boolean).join(' · ') || (c.certified ? t('pastry.certifiedChef') : '')}
        </T>
        {c.specialties?.length ? (
          <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 2 }}>
            {c.specialties.slice(0, 4).map((s) => (
              <View key={s} style={[styles.tag, { backgroundColor: `${PASTRY.caramel}26` }]}>
                <T size="xs" weight="600" color={PASTRY.choco}>{s}</T>
              </View>
            ))}
          </Row>
        ) : null}
      </View>
    </View>
  );
}

/** Photo privée (signée) avec agrandissement plein écran. */
export function PrivatePhoto({ bucket, path, label, height = 180 }: { bucket: string; path: string | null | undefined; label: string; height?: number }) {
  const { colors } = useSettings();
  const url = useSignedUrl(bucket, path);
  const [open, setOpen] = useState(false);
  if (!path) return null;
  return (
    <View style={{ gap: spacing.xs }}>
      <T size="sm" muted>{label}</T>
      <Pressable onPress={() => url.data && setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={label}
        style={[styles.photo, { height, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        {url.data ? <Image source={{ uri: url.data }} style={StyleSheet.absoluteFill} contentFit="cover" />
          : <Ionicons name="image-outline" size={28} color={colors.textMuted} />}
        {url.data ? (
          <View style={styles.zoom}><Ionicons name="expand-outline" size={16} color="#FFFFFF" /></View>
        ) : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(false)}>
          {url.data ? <Image source={{ uri: url.data }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

/** Ce que le client a demandé. */
export function RequestDetails({ order }: { order: PastryOrder }) {
  const { t, colors } = useSettings();
  const rows: [string, string | number | null | undefined][] = [
    [t('pastry.category'), t(`pastry.cat.${order.category}` as 'pastry.cat.cake')],
    [t('pastry.designation'), order.cake_type],
    [t('pastry.size'), order.size],
    [t('pastry.servings'), order.servings],
    [t('pastry.quantity'), order.quantity],
    [t('pastry.flavor'), order.flavor],
    [t('pastry.color'), order.color],
    [t('pastry.inscription'), order.inscription ? `« ${order.inscription} »` : null],
  ];
  return (
    <View style={{ gap: spacing.sm }}>
      {rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
        <View key={k} style={[styles.detail, { borderBottomColor: colors.border }]}>
          <T size="sm" muted style={{ width: 120 }}>{k}</T>
          <T size="sm" weight="600" style={{ flex: 1 }}>{String(v)}</T>
        </View>
      ))}
      {order.details ? (
        <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
          <T size="xs" muted>{t('pastry.details')}</T>
          <T size="sm" style={{ lineHeight: 20 }}>{order.details}</T>
        </View>
      ) : null}
      <PrivatePhoto bucket="cake-references" path={order.reference_photo_path} label={t('pastry.referencePhoto')} />
    </View>
  );
}

/** Bandeau crème de la pâtisserie (côté client), avec motifs discrets. */
export function PastryBanner({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <View style={[styles.banner, { backgroundColor: PASTRY.choco }]}>
      <View style={[styles.blob, { backgroundColor: PASTRY.raspberry, top: -40, right: -30, width: 150, height: 150, opacity: 0.35 }]} />
      <View style={[styles.blob, { backgroundColor: PASTRY.caramel, bottom: -50, left: -40, width: 140, height: 140, opacity: 0.22 }]} />
      <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={styles.bannerIcon}>
          <MaterialCommunityIcons name="cake-layered" size={28} color={PASTRY.raspberry} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <T size="xl" weight="800" color="#FFFFFF">{title}</T>
          <T size="sm" color={PASTRY.cocoaText} style={{ lineHeight: 19 }}>{text}</T>
        </View>
      </Row>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, maxWidth: 150 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  row: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  tlRow: { flexDirection: 'row', gap: spacing.md },
  tlRail: { alignItems: 'center', width: 22 },
  tlDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tlLine: { width: 2, flex: 1, minHeight: 14 },
  chef: { flexDirection: 'row', gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, alignItems: 'flex-start' },
  hat: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  tag: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  photo: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  zoom: { position: 'absolute', right: 8, bottom: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  detail: { flexDirection: 'row', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  note: { borderRadius: radius.md, padding: spacing.md, gap: 4 },
  banner: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999 },
  bannerIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: PASTRY.cream, alignItems: 'center', justifyContent: 'center' },
});
