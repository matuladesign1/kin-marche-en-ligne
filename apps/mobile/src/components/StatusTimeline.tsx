import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { formatDate } from '@/lib/format';
import { ORDER_STEPS, type OrderStatus } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';
import { Row, T } from './ui';

export function StatusTimeline({ status, history }: { status: OrderStatus; history: { status: OrderStatus; at: string; note: string | null }[] }) {
  const { colors, t, language } = useSettings();
  const stopped = ['cancelled', 'failed', 'refunded'].includes(status);
  const currentIndex = ORDER_STEPS.indexOf(status);
  const at = (s: OrderStatus) => history.find((h) => h.status === s)?.at;

  return (
    <View style={{ gap: 0 }}>
      {ORDER_STEPS.map((step, i) => {
        const done = !!at(step) || (!stopped && i <= currentIndex);
        const current = step === status;
        const color = done ? colors.success : colors.border;
        return (
          <Row key={step} gap={12} style={{ alignItems: 'flex-start' }}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={current ? colors.primary : color} />
              {i < ORDER_STEPS.length - 1 ? <View style={{ width: 2, height: 22, backgroundColor: color }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 6 }}>
              <T size="sm" weight={current ? '700' : '400'} muted={!done}>{t(`status.${step}`)}</T>
              {at(step) ? <T size="xs" muted>{formatDate(at(step), language)}</T> : null}
            </View>
          </Row>
        );
      })}
      {stopped ? (
        <Row gap={12}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
          <T weight="700" color={colors.danger}>{t(`status.${status}`)}</T>
        </Row>
      ) : null}
    </View>
  );
}
