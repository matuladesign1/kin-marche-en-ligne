import { Stack } from 'expo-router';
import { useSettings } from '@/providers/SettingsProvider';

export default function AuthLayout() {
  const { colors } = useSettings();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
