import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { LoyaltyWelcome } from '@/components/LoyaltyWelcome';
import type { IconName } from '@/components/ui';
import { useCart, useUnreadCount } from '@/hooks/data';
import { homeForRole } from '@/lib/roles';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

/** Icône pleine quand l'onglet est actif, contour sinon. */
function tabIcon(name: string) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons name={(focused ? name : `${name}-outline`) as IconName} color={color} size={size} />
  );
}

export default function CustomerTabs() {
  const { colors, t } = useSettings();
  const { profile } = useAuth();
  const cart = useCart();
  const unread = useUnreadCount();

  // Les comptes non-clients sont renvoyés vers leur espace.
  if (profile && profile.role !== 'customer') return <Redirect href={homeForRole(profile.role)} />;

  const count = cart.data?.lines.length ?? 0;
  const messages = unread.data?.total ?? 0;
  return (
    <>
      <LoyaltyWelcome />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.text,
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 62, paddingTop: 6, paddingBottom: 8 },
          tabBarBadgeStyle: { backgroundColor: colors.primary, fontSize: 10, fontWeight: '800' },
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800' },
        }}
      >
        <Tabs.Screen name="index" options={{ headerShown: false, title: t('tab.home'), tabBarIcon: tabIcon('home') }} />
        <Tabs.Screen name="categories" options={{ title: t('tab.categories'), tabBarIcon: tabIcon('grid') }} />
        <Tabs.Screen name="messages" options={{ title: t('tab.messages'), tabBarBadge: messages > 0 ? (messages > 99 ? '99+' : messages) : undefined, tabBarIcon: tabIcon('chatbox-ellipses') }} />
        <Tabs.Screen name="cart" options={{ title: t('tab.cart'), tabBarBadge: count > 0 ? count : undefined, tabBarIcon: tabIcon('cart') }} />
        <Tabs.Screen name="account" options={{ headerShown: false, title: t('tab.account'), tabBarIcon: tabIcon('person') }} />
      </Tabs>
    </>
  );
}
