import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/providers/AuthProvider';
import { SettingsProvider, useSettings } from '@/providers/SettingsProvider';
import { usePushRegistration } from '@/hooks/usePushRegistration';

function Navigator() {
  const { colors, isDark, t } = useSettings();
  usePushRegistration();
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
        <Stack.Screen name="support/index" options={{ title: t('support.title') }} />
        <Stack.Screen name="support/[id]" options={{ title: t('support.title') }} />
        <Stack.Screen name="cake" options={{ title: t('cake.title') }} />
        <Stack.Screen name="settings" options={{ title: t('account.settings') }} />
        <Stack.Screen name="store-admin/index" options={{ title: t('role.storeAdmin') }} />
        <Stack.Screen name="driver/index" options={{ title: t('role.driver') }} />
        <Stack.Screen name="admin/index" options={{ title: t('role.superAdmin') }} />
      </Stack>
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
