import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { Row } from '@/components/ui';
import { useSettings } from '@/providers/SettingsProvider';

export function Stars({ value, onChange, size = 34 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const { colors } = useSettings();
  return (
    <Row gap={4}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} accessibilityRole="button" accessibilityLabel={`${n}/5`} hitSlop={6}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? '#F5A623' : colors.textMuted} />
        </Pressable>
      ))}
    </Row>
  );
}

