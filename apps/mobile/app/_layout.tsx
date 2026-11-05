import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BasketLoader } from '@/components/BasketLoader';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider, useSettings } from '@/providers/SettingsProvider';
import { useLiveNotifications } from '@/hooks/useLiveNotifications';
import { useNotificationNavigation, usePushRegistration } from '@/hooks/usePushRegistration';

// Écran d'ouverture animé : affiché au démarrage le temps de charger la session (au moins 2,4 s).
function StartupOverlay() {
  const { colors } = useSettings();
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => { const h = setTimeout(() => setMinElapsed(true), 2400); return () => clearTimeout(h); }, []);
  if (!loading && minElapsed) return null;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.background, zIndex: 10 }}>
      <BasketLoader size="large" />
    </View>
  );
}

function Navigator() {
  const { colors, isDark, t } = useSettings();
  usePushRegistration();
  useNotificationNavigation();
  useLiveNotifications();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
          headerBackTitle: t('common.close'),
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(customer)" options={{ headerShown: false }} />
        <Stack.Screen name="product/[id]" options={{ title: '' }} />
        <Stack.Screen name="category/[id]" options={{ title: t('tab.categories') }} />
        <Stack.Screen name="search" options={{ title: t('search.title') }} />
        <Stack.Screen name="stores" options={{ title: t('stores.title') }} />
        <Stack.Screen name="checkout" options={{ title: t('checkout.title') }} />
        <Stack.Screen name="addresses/index" options={{ title: t('address.title') }} />
        <Stack.Screen name="addresses/new" options={{ title: t('address.new') }} />
        <Stack.Screen name="order/[id]" options={{ title: t('orders.details') }} />
        <Stack.Screen name="payment/[orderId]" options={{ title: t('payment.title') }} />
        <Stack.Screen name="loyalty" options={{ title: t('loyalty.title') }} />
        <Stack.Screen name="favorites" options={{ title: t('favorites.title') }} />
        <Stack.Screen name="coupons" options={{ title: t('coupons.title') }} />
        <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
        <Stack.Screen name="support/index" options={{ title: t('inbox.title') }} />
        <Stack.Screen name="support/[id]" options={{ title: '' }} />
        <Stack.Screen name="about" options={{ title: t('about.title') }} />
        <Stack.Screen name="cake" options={{ title: t('cake.title') }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
        <Stack.Screen name="orders" options={{ title: t('orders.mine') }} />
        <Stack.Screen name="wheel" options={{ title: t('wheel.title') }} />
        <Stack.Screen name="recent" options={{ title: t('account.history') }} />
        <Stack.Screen name="collection/[kind]" options={{ title: '' }} />
        <Stack.Screen name="legal/index" options={{ title: t('settings.legal') }} />
        <Stack.Screen name="me/notifications" options={{ title: t('account.notifications') }} />
        <Stack.Screen name="me/profile" options={{ title: t('profile.title') }} />
        <Stack.Screen name="me/password" options={{ title: t('account.changePassword') }} />
        <Stack.Screen name="me/email" options={{ title: t('account.changeEmail') }} />
        <Stack.Screen name="me/delete" options={{ title: t('account.deleteAccount') }} />
        <Stack.Screen name="me/rate" options={{ title: t('account.rateApp') }} />
        <Stack.Screen name="me/permissions" options={{ title: t('account.permissions') }} />
        <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
        <Stack.Screen name="order/proof/[id]" options={{ title: t('proof.title') }} />
        <Stack.Screen name="order/review/[id]" options={{ title: t('review.title') }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="store-admin/index" options={{ title: t('role.storeAdmin') }} />
        <Stack.Screen name="driver/index" options={{ title: t('driver.spaceTitle') }} />
        <Stack.Screen name="driver/offers" options={{ title: t('driver.availableRuns') }} />
        <Stack.Screen name="driver/history" options={{ title: t('driver.history') }} />
        <Stack.Screen name="driver/mission/[id]" options={{ title: t('driver.mission') }} />
        <Stack.Screen name="driver/earnings" options={{ title: t('driver.earnings') }} />
        <Stack.Screen name="driver/card" options={{ title: t('driver.card') }} />
        <Stack.Screen name="driver-signup" options={{ title: t('driver.signupTitle') }} />
        <Stack.Screen name="admin/index" options={{ title: t('role.superAdmin') }} />
      </Stack>
      <StartupOverlay />
    </>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <AuthProvider>
            <Navigator />
          </AuthProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
