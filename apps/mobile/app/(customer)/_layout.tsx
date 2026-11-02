import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useCart } from '@/hooks/data';
import { homeForRole } from '@/lib/roles';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function CustomerTabs() {
  const { colors, t } = useSettings();
  const { profile } = useAuth();
  const cart = useCart();

  // Les comptes non-clients sont renvoyés vers leur espace.
  if (profile && profile.role !== 'customer') return <Redirect href={homeForRole(profile.role)} />;

  const count = cart.data?.lines.length ?? 0;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen name="index" options={{ headerShown: false, title: t('tab.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="categories" options={{ title: t('tab.categories'), tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="cart" options={{ title: t('tab.cart'), tabBarBadge: count > 0 ? count : undefined, tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="orders" options={{ title: t('tab.orders'), tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: t('tab.account'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
