import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppFooter } from '@/components/AppFooter';
import { Avatar, FlagCD, ListGroup, ListRow, OptionSheet } from '@/components/kit';
import { T } from '@/components/ui';
import { useAppUpdate } from '@/hooks/data';
import { formatDate } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { radius, spacing } from '@/lib/theme';
import type { Currency, Language } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const CURRENCIES: { code: Currency; label: string }[] = [
  { code: 'USD', label: 'USD — Dollar américain' },
  { code: 'CDF', label: 'CDF — Franc congolais' },
  { code: 'EUR', label: 'EUR — Euro' },
];

type Sheet = 'currency' | 'language' | 'theme' | null;
type ThemeMode = 'system' | 'light' | 'dark';

export default function Settings() {
  const { t, colors, language, setLanguage, currency, setCurrency, themeMode, setThemeMode, rates } = useSettings();
  const { session, profile, signOut } = useAuth();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<Sheet>(null);

  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '';
  const buildRaw = Application.nativeBuildVersion;
  const build = buildRaw && /^\d+$/.test(buildRaw) ? Number(buildRaw) : null;
  const update = useAppUpdate(build);

  const saveRemote = (patch: Record<string, string>) => {
    if (session) supabase.from('profiles').update(patch).eq('id', session.user.id).then(() => undefined);
  };

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

  const logout = () => Alert.alert(t('auth.signOut'), t('settings.signOutConfirm'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('auth.signOut'), style: 'destructive', onPress: async () => { await signOut(); qc.clear(); router.replace('/'); } },
  ]);

  const themeLabel = (m: ThemeMode) => t(`settings.theme.${m}`);
  const languageLabel = LANGUAGES.find((l) => l.code === language)?.label ?? language;

  const updateRight = update.data?.newer ? (
    <Pressable
      // Android : téléchargement dans l'application avec la progression réelle (écran « update »).
      onPress={() => (Platform.OS === 'android' && update.data?.apkUrl ? router.push('/update') : Linking.openURL(update.data!.url))}
      style={[styles.updateBtn, { backgroundColor: colors.primary }]} accessibilityRole="button">
      <T size="xs" weight="800" color={colors.onPrimary}>{t('settings.updateNow')}</T>
    </Pressable>
  ) : (
    <T size="sm" weight="700" muted>{update.data ? t('settings.upToDate') : ''}</T>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingVertical: spacing.md, gap: spacing.lg }}>
      <ListGroup>
        {session ? (
          <ListRow label={t('settings.myProfile')} onPress={() => router.push('/me/profile')} />
        ) : (
          <ListRow label={t('auth.signIn')} icon="log-in-outline" onPress={() => router.push('/(auth)/sign-in')} />
        )}
      </ListGroup>

      <ListGroup>
        <View style={styles.country}>
          <FlagCD width={26} />
          <T muted>{t('settings.country')}</T>
        </View>
        <ListRow label={t('settings.currency')} value={currency} onPress={() => setSheet('currency')} />
        <ListRow label={t('settings.language')} value={languageLabel} onPress={() => setSheet('language')} />
        <ListRow label={t('settings.theme')} value={themeLabel(themeMode)} onPress={() => setSheet('theme')} />
        <ListRow label={t('account.notifications')} onPress={() => router.push(session ? '/me/notifications' : '/(auth)/sign-in')} />
        {session ? <ListRow label={t('account.changePassword')} onPress={() => router.push('/me/password')} /> : null}
        {session ? <ListRow label={t('account.changeEmail')} onPress={() => router.push('/me/email')} /> : null}
        <ListRow label={t('account.permissions')} onPress={() => router.push('/me/permissions')} />
        {session ? <ListRow label={t('account.deleteAccount')} onPress={() => router.push('/me/delete')} /> : null}
      </ListGroup>

      <ListGroup>
        <ListRow label={t('settings.version')} subtitle={build ? `${version} (${t('settings.build', { n: build })})` : version} right={updateRight} />
        <ListRow label={t('settings.legal')} onPress={() => router.push('/legal')} />
        {session ? <ListRow label={t('account.rateApp')} onPress={() => router.push('/me/rate')} /> : null}
        <ListRow label={t('account.clearCache')} onPress={clearCache} />
        <ListRow label={t('about.title')} onPress={() => router.push('/about')} />
      </ListGroup>

      {session ? (
        <ListGroup>
          <ListRow label={t('account.switchAccount')} onPress={switchAccount}
            right={<Avatar uri={profile?.avatar_url} name={profile?.full_name ?? profile?.email} size={32} />} />
        </ListGroup>
      ) : null}

      {session ? (
        <ListGroup>
          <ListRow label={t('auth.signOut')} onPress={logout} chevron={false} />
        </ListGroup>
      ) : null}

      <AppFooter />

      <OptionSheet<Currency>
        visible={sheet === 'currency'}
        title={t('settings.currency')}
        selected={currency}
        onClose={() => setSheet(null)}
        onSelect={(c) => { setCurrency(c); saveRemote({ currency: c }); }}
        options={CURRENCIES.map((c) => {
          const r = rates[c.code];
          return {
            value: c.code,
            label: c.label,
            disabled: c.code !== 'USD' && !r,
            subtitle: c.code === 'USD' ? undefined
              : r ? t('settings.rateDate', { date: formatDate(r.updatedAt, language), rate: r.rate, cur: c.code }) : t('settings.rateMissing'),
          };
        })}
      />
      <OptionSheet<Language>
        visible={sheet === 'language'}
        title={t('settings.language')}
        selected={language}
        onClose={() => setSheet(null)}
        onSelect={(l) => { setLanguage(l); saveRemote({ language: l }); }}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
      />
      <OptionSheet<ThemeMode>
        visible={sheet === 'theme'}
        title={t('settings.theme')}
        selected={themeMode}
        onClose={() => setSheet(null)}
        onSelect={setThemeMode}
        options={(['system', 'light', 'dark'] as const).map((m) => ({ value: m, label: themeLabel(m) }))}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  country: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.lg },
  updateBtn: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
