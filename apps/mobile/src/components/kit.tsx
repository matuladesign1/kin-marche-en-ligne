import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Children, Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { font, radius, spacing } from '@/lib/theme';
import { useSettings } from '@/providers/SettingsProvider';
import { T, type IconName } from './ui';

// Éléments d'interface « plateforme professionnelle » : blocs blancs sans bordure,
// listes de réglages, tuiles d'icônes avec compteur, en-têtes en dégradé.

/** Bloc blanc arrondi. */
export function Panel({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { colors } = useSettings();
  return <View style={[styles.panel, padded && styles.panelPadded, { backgroundColor: colors.surface }, style]}>{children}</View>;
}

/** Titre de bloc avec action « Voir tout › ». */
export function PanelHeader({ title, action, onAction, size = 'lg' }: { title: string; action?: string; onAction?: () => void; size?: 'md' | 'lg' | 'xl' }) {
  const { colors } = useSettings();
  return (
    <View style={styles.panelHeader}>
      <T size={size} weight="800" style={{ flexShrink: 1 }}>{title}</T>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} style={styles.headerAction} accessibilityRole="button">
          <T size="sm" muted>{action}</T>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Groupe de lignes (réglages, profil) : fond blanc, séparateurs fins. */
export function ListGroup({ children, title, footer, style }: { children: ReactNode; title?: string; footer?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useSettings();
  const items = Children.toArray(children);
  return (
    <View style={style}>
      {title ? <T size="sm" weight="700" muted style={styles.groupTitle}>{title}</T> : null}
      <View style={[styles.group, { backgroundColor: colors.surface }]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? <T size="xs" muted style={styles.groupFooter}>{footer}</T> : null}
    </View>
  );
}

/** Ligne : libellé à gauche, valeur à droite, chevron. */
export function ListRow({ label, value, subtitle, icon, iconColor, onPress, danger, right, chevron = true, center, accessibilityHint }: {
  label: string; value?: string | null; subtitle?: string | null; icon?: IconName; iconColor?: string; onPress?: () => void;
  danger?: boolean; right?: ReactNode; chevron?: boolean; center?: boolean; accessibilityHint?: string;
}) {
  const { colors } = useSettings();
  const content = (
    <View style={[styles.row, center && { justifyContent: 'center' }]}>
      {icon ? <Ionicons name={icon} size={22} color={danger ? colors.danger : iconColor ?? colors.text} /> : null}
      <View style={{ flex: center ? 0 : 1, gap: 2 }}>
        <T size="md" color={danger ? colors.danger : undefined} numberOfLines={1}>{label}</T>
        {subtitle ? <T size="xs" muted numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {value ? <T size="md" muted numberOfLines={1} style={{ maxWidth: '55%', textAlign: 'right' }}>{value}</T> : null}
      {right}
      {onPress && chevron && !center ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}>
      {content}
    </Pressable>
  );
}

/** Pastille de compteur rouge (99+). */
export function CountBadge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useSettings();
  if (!count) return null;
  return (
    <View style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.surface }, style]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** Icône + libellé (grilles « Mes commandes », « Plus de fonctionnalités »). */
export function IconTile({ icon, label, count, onPress, color, width = '20%', custom }: {
  icon?: IconName; label: string; count?: number; onPress?: () => void; color?: string; width?: `${number}%` | number; custom?: ReactNode;
}) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={count ? `${label} (${count})` : label}
      style={({ pressed }) => [styles.tile, { width, opacity: pressed ? 0.6 : 1 }]}>
      <View>
        {custom ?? <Ionicons name={icon ?? 'ellipse-outline'} size={28} color={color ?? colors.text} />}
        <CountBadge count={count ?? 0} style={styles.tileBadge} />
      </View>
      <T size="xs" style={{ textAlign: 'center', lineHeight: 16 }} numberOfLines={2}>{label}</T>
    </Pressable>
  );
}

/** Photo de profil ronde, ou initiales. */
export function Avatar({ uri, name, size = 56 }: { uri?: string | null; name?: string | null; size?: number }) {
  const { colors } = useSettings();
  const initials = (name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceAlt }} contentFit="cover" />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.onPrimary, fontSize: size * 0.38, fontWeight: '800' }}>{initials}</Text>
    </View>
  );
}

/** Drapeau de la RDC (dessiné, identique sur tous les téléphones). */
export function FlagCD({ width = 24 }: { width?: number }) {
  const h = width * 0.75;
  return (
    <Svg width={width} height={h} viewBox="0 0 40 30" accessibilityLabel="RDC">
      <Rect width="40" height="30" fill="#007FFF" />
      <Polygon points="0,26 33,0 40,0 40,4 7,30 0,30" fill="#F7D618" />
      <Polygon points="0,28.5 36,0 40,0 40,1.5 4,30 0,30" fill="#CE1021" />
      <Polygon points="7,2.2 8.3,6 12.3,6 9.1,8.4 10.3,12.2 7,9.9 3.7,12.2 4.9,8.4 1.7,6 5.7,6" fill="#F7D618" />
    </Svg>
  );
}

/** Fond en dégradé vertical (en-têtes). */
export function GradientBg({ from, to, style }: { from: string; to: string; style?: StyleProp<ViewStyle> }) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 10 10">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="10" height="10" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const WHEEL_COLORS = ['#DE3530', '#0097FC', '#E8A317', '#13A35F', '#01789D', '#7B3FE4'];

/** Petite roue colorée (icône de la Roue de la chance). */
export function WheelIcon({ size = 28 }: { size?: number }) {
  const n = WHEEL_COLORS.length;
  const paths = WHEEL_COLORS.map((c, i) => {
    const a0 = (2 * Math.PI * i) / n - Math.PI / 2;
    const a1 = (2 * Math.PI * (i + 1)) / n - Math.PI / 2;
    const x0 = 12 + 11 * Math.cos(a0); const y0 = 12 + 11 * Math.sin(a0);
    const x1 = 12 + 11 * Math.cos(a1); const y1 = 12 + 11 * Math.sin(a1);
    return <Path key={c} d={`M12 12 L${x0.toFixed(2)} ${y0.toFixed(2)} A11 11 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} fill={c} />;
  });
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <G>{paths}</G>
      <Path d="M12 9.2 A2.8 2.8 0 1 1 11.99 9.2 Z" fill="#FFFFFF" />
      <Polygon points="12,0.2 14,3.6 10,3.6" fill="#16181D" />
    </Svg>
  );
}

/** Filtre arrondi (« Tous », « Promotions »…) : sélection = contour foncé. */
export function FilterChip({ label, icon, iconColor, active, onPress }: { label: string; icon?: IconName; iconColor?: string; active?: boolean; onPress?: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }}
      style={[styles.filterChip, {
        backgroundColor: active ? colors.surface : colors.surfaceAlt,
        borderColor: active ? colors.text : 'transparent',
      }]}>
      {icon ? <Ionicons name={icon} size={16} color={iconColor ?? colors.primary} /> : null}
      <Text style={{ color: colors.text, fontSize: font.md, fontWeight: active ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

/** Onglets texte avec soulignement (haut de l'accueil). L'onglet actif est toujours ramené à l'écran. */
export function TopTabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  const { colors } = useSettings();
  const scroll = useRef<ScrollView>(null);
  const xs = useRef<Partial<Record<K, number>>>({});
  const reveal = (k: K) => {
    const x = xs.current[k];
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - spacing.lg), animated: true });
  };
  useEffect(() => { reveal(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topTabs}>
      {tabs.map((tb) => {
        const active = tb.key === value;
        return (
          <Pressable key={tb.key} onPress={() => onChange(tb.key)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.topTab}
            onLayout={(e) => { xs.current[tb.key] = e.nativeEvent.layout.x; if (active) reveal(tb.key); }}>
            <Text style={{ color: colors.text, fontSize: active ? 22 : 17, fontWeight: '800' }}>{tb.label}</Text>
            <View style={[styles.topTabBar, { backgroundColor: active ? colors.primary : 'transparent' }]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export interface SheetOption<V extends string> { value: V; label: string; subtitle?: string; disabled?: boolean; left?: ReactNode }

/** Choix dans une feuille qui monte du bas (devise, langue, thème…). */
export function OptionSheet<V extends string>({ visible, title, options, selected, onSelect, onClose }: {
  visible: boolean; title: string; options: SheetOption<V>[]; selected?: V | null; onSelect: (v: V) => void; onClose: () => void;
}) {
  const { colors, t } = useSettings();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
        <T size="lg" weight="800" style={{ textAlign: 'center', marginBottom: spacing.sm }}>{title}</T>
        <ScrollView style={{ maxHeight: 420 }}>
          {options.map((o) => {
            const on = o.value === selected;
            return (
              <Pressable key={o.value} disabled={o.disabled} onPress={() => { onSelect(o.value); onClose(); }}
                accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !!o.disabled }}
                style={({ pressed }) => [styles.sheetRow, { opacity: o.disabled ? 0.45 : 1, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}>
                {o.left}
                <View style={{ flex: 1, gap: 2 }}>
                  <T weight={on ? '700' : '400'}>{o.label}</T>
                  {o.subtitle ? <T size="xs" muted>{o.subtitle}</T> : null}
                </View>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, overflow: 'hidden' },
  panelPadded: { padding: spacing.lg, gap: spacing.md },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  group: { borderRadius: radius.md, overflow: 'hidden', marginHorizontal: spacing.md },
  groupTitle: { marginHorizontal: spacing.md + spacing.lg, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  groupFooter: { marginHorizontal: spacing.md + spacing.lg, marginTop: 6 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 56, paddingVertical: 10 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  tile: { alignItems: 'center', gap: 6, paddingVertical: spacing.sm, paddingHorizontal: 2 },
  tileBadge: { position: 'absolute', top: -8, right: -12 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1.5, paddingHorizontal: spacing.lg, minHeight: 40 },
  topTabs: { gap: spacing.xl, paddingHorizontal: spacing.lg, alignItems: 'flex-end' },
  topTab: { alignItems: 'center', gap: 6 },
  topTabBar: { height: 4, width: '70%', borderRadius: 2 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: spacing.md },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, minHeight: 56, paddingVertical: 8 },
});
