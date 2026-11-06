import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '@/providers/SettingsProvider';
import { BasketLoader } from './BasketLoader';
import { font, radius, spacing } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true, padded = true, edges }: {
  children: ReactNode; scroll?: boolean; padded?: boolean; edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { colors } = useSettings();
  const content = padded ? { padding: spacing.lg, gap: spacing.lg } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={edges ?? ['left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[content, { paddingBottom: spacing.xxl * 2 }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, content]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function T({ children, size = 'md', weight = '400', muted, color, style, numberOfLines }: {
  children: ReactNode; size?: keyof typeof font; weight?: TextStyle['fontWeight']; muted?: boolean;
  color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number;
}) {
  const { colors } = useSettings();
  return (
    <Text maxFontSizeMultiplier={1.15}
      numberOfLines={numberOfLines}
      style={[{ fontSize: font[size], fontWeight: weight, color: color ?? (muted ? colors.textMuted : colors.text) }, style]}
    >
      {children}
    </Text>
  );
}

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useSettings();
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.surfaceAlt : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? colors.onPrimary : variant === 'ghost' ? colors.primary : colors.text;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text maxFontSizeMultiplier={1.15} style={{ color: fg, fontSize: font.md, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; error?: string | null }) {
  const { colors } = useSettings();
  const { label, error, style, ...rest } = props;
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <T size="sm" muted>{label}</T> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        {...rest}
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border, color: colors.text },
          style,
        ]}
      />
      {error ? <T size="xs" color={colors.danger}>{error}</T> : null}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { colors } = useSettings();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }]}>
      {children}
    </Pressable>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  const { colors } = useSettings();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[styles.chip, {
        backgroundColor: active ? colors.primary : colors.surface,
        borderColor: active ? colors.primary : colors.border,
      }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? colors.onPrimary : colors.text} /> : null}
      <Text maxFontSizeMultiplier={1.15} style={{ color: active ? colors.onPrimary : colors.text, fontSize: font.sm, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style, gap = spacing.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useSettings();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <T size="lg" weight="700">{title}</T>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text maxFontSizeMultiplier={1.15} style={{ color: colors.primary, fontWeight: '600', fontSize: font.sm }}>{action}</Text>
        </Pressable>
      ) : null}
    </Row>
  );
}

export function Loading({ label }: { label?: string } = {}) {
  return <BasketLoader size="small" label={label} />;
}

export function EmptyState({ icon = 'basket-outline', message, action, onAction }: {
  icon?: IconName; message: string; action?: string; onAction?: () => void;
}) {
  const { colors } = useSettings();
  return (
    <View style={[styles.center, { paddingVertical: spacing.xxl }]}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <T muted style={{ textAlign: 'center' }}>{message}</T>
      {action && onAction ? <Button title={action} onPress={onAction} variant="ghost" /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useSettings();
  return <EmptyState icon="cloud-offline-outline" message={message} action={onRetry ? t('common.retry') : undefined} onAction={onRetry} />;
}

export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const { colors } = useSettings();
  const c = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.accent2;
  const icon: IconName = tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'warning' : tone === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View style={[styles.notice, { borderColor: c, backgroundColor: colors.surface }]}>
      <Ionicons name={icon} size={20} color={c} />
      <T size="sm" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

export function Divider() {
  const { colors } = useSettings();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: font.md },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 36,
  },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  notice: { flexDirection: 'row', gap: spacing.sm, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, padding: spacing.md, alignItems: 'flex-start' },
});
