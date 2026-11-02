import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Divider, Row, Screen, SectionHeader, T, type IconName } from '@/components/ui';
import { maskPhone } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

interface Link { icon: IconName; label: string; href?: string; onPress?: () => void; auth?: boolean; danger?: boolean }

export default function Account() {
  const { t, colors } = useSettings();
  const { session, profile, signOut } = useAuth();
  const qc = useQueryClient();

  const clearCache = () => Alert.alert(t('account.clearCache'), t('account.clearCacheConfirm'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('common.confirm'), onPress: async () => {
        qc.clear();
        await Promise.allSettled([Image.clearDiskCache(), Image.clearMemoryCache()]);
        // Supprime les données temporaires mais conserve la session et les réglages (langue, devise, thème, magasin).
        const keys = await AsyncStorage.getAllKeys();
        const temp = keys.filter((k) => k.startsWith('km.cache.') || k.startsWith('km.tmp.'));
        if (temp.length) await AsyncStorage.multiRemove(temp);
        Alert.alert(t('account.clearCache'), t('account.cacheCleared'));
      },
    },
  ]);

  const switchAccount = () => Alert.alert(t('account.switchAccount'), t('account.switchConfirm'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.confirm'), onPress: async () => { await signOut(); qc.clear(); router.replace('/(auth)/sign-in'); } },
  ]);

  const sections: { title: string; links: Link[] }[] = [
    {
      title: t('account.section.shopping'),
      links: [
        { icon: 'receipt-outline', label: t('orders.title'), href: '/(customer)/orders', auth: true },
        { icon: 'location-outline', label: t('account.addresses'), href: '/addresses', auth: true },
        { icon: 'heart-outline', label: t('favorites.title'), href: '/favorites', auth: true },
        { icon: 'star-outline', label: t('loyalty.title'), href: '/loyalty', auth: true },
        { icon: 'pricetag-outline', label: t('coupons.title'), href: '/coupons', auth: true },
        { icon: 'notifications-outline', label: t('account.notifications'), href: '/notifications', auth: true },
        { icon: 'chatbubbles-outline', label: t('support.title'), href: '/support', auth: true },
        { icon: 'storefront-outline', label: t('stores.title'), href: '/stores' },
      ],
    },
    {
      title: t('account.section.security'),
      links: [
        { icon: 'person-outline', label: t('account.editProfile'), href: '/me/profile', auth: true },
        { icon: 'key-outline', label: t('account.changePassword'), href: '/me/password', auth: true },
        { icon: 'mail-outline', label: t('account.changeEmail'), href: '/me/email', auth: true },
        { icon: 'swap-horizontal-outline', label: t('account.switchAccount'), onPress: switchAccount, auth: true },
        { icon: 'trash-outline', label: t('account.deleteAccount'), href: '/me/delete', auth: true, danger: true },
      ],
    },
    {
      title: t('account.section.legal'),
      links: [
        { icon: 'document-text-outline', label: t('account.terms'), href: '/legal/terms' },
        { icon: 'ribbon-outline', label: t('account.license'), href: '/legal/license' },
        { icon: 'shield-checkmark-outline', label: t('account.privacy'), href: '/legal/privacy' },
        { icon: 'options-outline', label: t('account.cookies'), href: '/legal/cookies' },
        { icon: 'lock-open-outline', label: t('account.permissions'), href: '/me/permissions' },
      ],
    },
    {
      title: t('account.section.app'),
      links: [
        { icon: 'language-outline', label: t('account.settings'), href: '/settings' },
        { icon: 'star-half-outline', label: t('account.rateApp'), href: '/me/rate', auth: true },
        { icon: 'refresh-circle-outline', label: t('account.clearCache'), onPress: clearCache },
      ],
    },
  ];

  return (
    <Screen>
      {session && profile ? (
        <Card onPress={() => router.push('/me/profile')}>
          <Row gap={14}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={{ width: 64, height: 64, borderRadius: 32 }} accessibilityLabel={t('account.photo')} />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="camera-outline" size={28} color={colors.onPrimary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <T size="lg" weight="700">{profile.full_name ?? profile.email}</T>
              <T muted size="sm">{profile.email}</T>
              {profile.phone ? <T muted size="sm">{maskPhone(profile.phone)}</T> : null}
            </View>
            <Ionicons name="create-outline" size={20} color={colors.textMuted} />
          </Row>
        </Card>
      ) : (
        <Button title={t('auth.signIn')} onPress={() => router.push('/(auth)/sign-in')} />
      )}

      {sections.map((sec) => {
        const links = sec.links.filter((l) => !l.auth || session);
        if (!links.length) return null;
        return (
          <View key={sec.title}>
            <SectionHeader title={sec.title} />
            <Card style={{ paddingVertical: 4 }}>
              {links.map((l, i) => (
                <Pressable key={l.label} onPress={() => (l.onPress ? l.onPress() : router.push(l.href as never))} accessibilityRole="button">
                  <Row style={{ paddingVertical: 12 }}>
                    <Ionicons name={l.icon} size={22} color={l.danger ? colors.danger : colors.primary} />
                    <T style={{ flex: 1 }} color={l.danger ? colors.danger : undefined}>{l.label}</T>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Row>
                  {i < links.length - 1 ? <Divider /> : null}
                </Pressable>
              ))}
            </Card>
          </View>
        );
      })}

      {session ? <Button title={t('auth.signOut')} variant="ghost" icon="log-out-outline" onPress={() => signOut().then(() => { qc.clear(); router.replace('/'); })} /> : null}
      <T size="xs" muted style={{ textAlign: 'center' }}>{t('account.version', { v: Application.nativeApplicationVersion ?? '0.1.0' })}</T>
      <T size="xs" muted style={{ textAlign: 'center' }}>{t('account.developer')} · +243 849 009 239</T>
    </Screen>
  );
}
