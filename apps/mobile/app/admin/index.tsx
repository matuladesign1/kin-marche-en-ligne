import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { Linking } from 'react-native';
import { Button, Card, Loading, Notice, Screen, T } from '@/components/ui';
import { homeForRole } from '@/lib/roles';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Garde d'accès : seul le rôle « super_admin » voit cet écran (les données restent protégées par la RLS).
export default function Space() {
  const { t, colors } = useSettings();
  const { loading, profile, signOut } = useAuth();
  if (loading) return <Loading />;
  if (profile?.role !== 'super_admin' && profile?.role !== 'agent') return <Redirect href={homeForRole(profile?.role)} />;
  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        <Ionicons name="shield-checkmark-outline" size={48} color={colors.primary} />
        <T size="lg" weight="700">{profile.role === 'agent' ? t('role.agent') : t('role.superAdmin')}</T>
        <T muted>{profile.full_name ?? profile.email}</T>
      </Card>
      <Notice text={t('role.useWeb')} />
      <Button title="kin-marche-admin.vercel.app" icon="open-outline" variant="secondary" onPress={() => Linking.openURL('https://kin-marche-admin.vercel.app')} />
      <Button title={t('auth.signOut')} variant="ghost" icon="log-out-outline" onPress={() => signOut().then(() => router.replace('/'))} />
    </Screen>
  );
}
