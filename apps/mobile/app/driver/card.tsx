import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import QRCode from 'react-native-qrcode-svg';
import { View } from 'react-native';
import { BrandLogo } from '@/components/BrandHeader';
import { Card, Loading, Screen, T } from '@/components/ui';
import { useDriver } from '@/hooks/driver';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

// Carte professionnelle numérique. Le QR code contient l'identifiant unique du livreur,
// que le magasin ou le client peut vérifier auprès de Kin Marché.
export default function DriverCard() {
  const { t, language, colors } = useSettings();
  const { profile } = useAuth();
  const d = useDriver();
  if (d.isLoading || !d.data || !profile) return <Loading />;
  const verified = d.data.status === 'verified';
  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: 12, borderWidth: 2, borderColor: verified ? colors.success : colors.danger }}>
        <BrandLogo height={40} />
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={{ width: 120, height: 120, borderRadius: 60 }} accessibilityLabel={profile.full_name ?? ''} />
        ) : <Ionicons name="person-circle-outline" size={120} color={colors.textMuted} />}
        <T size="xl" weight="700">{profile.full_name}</T>
        <T weight="700" style={{ letterSpacing: 2 }}>{d.data.driver_code}</T>
        <T color={verified ? colors.success : colors.danger} weight="600">{t(`driver.status.${d.data.status as 'verified'}`)}</T>
        {d.data.verified_at ? <T size="sm" muted>{t('driver.validatedOn', { date: formatDate(d.data.verified_at, language, false) })}</T> : null}
        <View style={{ padding: 12, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
          <QRCode value={`KINMARCHE-LIVREUR:${d.data.driver_code}`} size={180} />
        </View>
        <T size="sm" muted>{t('driver.cardCompany')}</T>
      </Card>
    </Screen>
  );
}
