import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { bannersQuery } from '@/components/BannerCarousel';
import { LoadingScreen } from '@/components/KinLoader';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider, useSettings } from '@/providers/SettingsProvider';
import { useLiveNotifications } from '@/hooks/useLiveNotifications';
import { useNotificationNavigation, usePushRegistration } from '@/hooks/usePushRegistration';

// L'écran natif (rouge, logo) reste affiché jusqu'à ce que l'écran animé soit prêt : aucun écran blanc entre les deux.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
try { SplashScreen.setOptions({ duration: 250, fade: true }); } catch { /* ancienne version : fondu par défaut */ }
const hideSplash = () => { SplashScreen.hideAsync().catch(() => undefined); };

/**
 * Écran d'ouverture animé, sans texte : la boule au logo saute et se transforme en produits.
 * Pendant ce temps, la session se charge et les bannières de l'accueil sont préchargées ;
 * l'accueil s'affiche dès que l'application est prête, sans attente artificielle (fondu de 0,3 s).
 */
function StartupOverlay() {
  const { loading } = useAuth();
  const qc = useQueryClient();
  const opacity = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);

  useEffect(() => {
    qc.prefetchQuery(bannersQuery('home'))
      .then(() => {
        const urls = (qc.getQueryData(bannersQuery('home').queryKey) ?? []).map((b) => b.image_url);
        if (urls.length) Image.prefetch(urls).catch(() => undefined);
      })
      .catch(() => undefined);
  }, [qc]);

  useEffect(() => {
    if (loading) return;
    hideSplash();
    Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setGone(true));
  }, [loading, opacity]);

  if (gone) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 10, opacity }]} pointerEvents={loading ? 'auto' : 'none'}>
      <StatusBar style="dark" />
      <LoadingScreen onLayout={hideSplash} />
    </Animated.View>
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
        <Stack.Screen name="update" options={{ headerShown: false, animation: 'fade' }} />
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
    // Données gardées 10 min en mémoire : retour instantané sur un écran déjà vu, moins de données mobiles consommées.
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1 } } }),
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
