import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { Button, Card, Divider, Row, Screen, T, type IconName } from '@/components/ui';
import { maskPhone } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

export default function Account() {
  const { t, colors } = useSettings();
  const { session, profile, signOut } = useAuth();

  const links: { icon: IconName; label: string; href: string; auth?: boolean }[] = [
    { icon: 'location-outline', label: t('account.addresses'), href: '/addresses', auth: true },
    { icon: 'receipt-outline', label: t('orders.title'), href: '/(customer)/orders', auth: true },
    { icon: 'heart-outline', label: t('favorites.title'), href: '/favorites', auth: true },
    { icon: 'star-outline', label: t('loyalty.title'), href: '/loyalty', auth: true },
    { icon: 'pricetag-outline', label: t('coupons.title'), href: '/coupons', auth: true },
    { icon: 'notifications-outline', label: t('account.notifications'), href: '/notifications', auth: true },
    { icon: 'chatbubbles-outline', label: t('support.title'), href: '/support', auth: true },
    { icon: 'storefront-outline', label: t('stores.title'), href: '/stores' },
    { icon: 'settings-outline', label: t('account.settings'), href: '/settings' },
  ];

  return (
    <Screen>
      {session && profile ? (
        <Card>
          <T size="lg" weight="700">{profile.full_name ?? profile.email}</T>
          <T muted>{profile.email}</T>
          {profile.phone ? <T muted>{maskPhone(profile.phone)}</T> : null}
        </Card>
      ) : (
        <Button title={t('auth.signIn')} onPress={() => router.push('/(auth)/sign-in')} />
      )}

      <Card style={{ paddingVertical: 4 }}>
        {links.filter((l) => !l.auth || session).map((l, i, arr) => (
          <Pressable key={l.href} onPress={() => router.push(l.href as never)} accessibilityRole="button">
            <Row style={{ paddingVertical: 12 }}>
              <Ionicons name={l.icon} size={22} color={colors.primary} />
              <T style={{ flex: 1 }}>{l.label}</T>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Row>
            {i < arr.length - 1 ? <Divider /> : null}
          </Pressable>
        ))}
      </Card>

      {session ? <Button title={t('auth.signOut')} variant="ghost" icon="log-out-outline" onPress={() => signOut().then(() => router.replace('/'))} /> : null}
      <T size="xs" muted style={{ textAlign: 'center' }}>{t('account.developer')} · +243 849 009 239</T>
    </Screen>
  );
}
