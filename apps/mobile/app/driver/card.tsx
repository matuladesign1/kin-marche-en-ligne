import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import QRCode from 'react-native-qrcode-svg';
import { StyleSheet, View } from 'react-native';
import { BrandLogo } from '@/components/BrandHeader';
import { CERTIFIED_BLUE, CERTIFIED_GREEN, CertifiedBadge } from '@/components/CertifiedBadge';
import { Card, Loading, Row, Screen, T } from '@/components/ui';
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
      <Card style={{ alignItems: 'center', gap: 12, borderWidth: 2, borderColor: verified ? CERTIFIED_BLUE : colors.danger }}>
        <BrandLogo height={40} />
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={{ width: 120, height: 120, borderRadius: 60 }} accessibilityLabel={profile.full_name ?? ''} />
        ) : <Ionicons name="person-circle-outline" size={120} color={colors.textMuted} />}
        <Row gap={8}>
          <T size="xl" weight="700">{profile.full_name}</T>
          {verified ? <CertifiedBadge size={26} label={t('driver.status.verified')} /> : null}
        </Row>
        <T weight="700" style={{ letterSpacing: 2 }}>{d.data.driver_code}</T>
        {verified ? (
          <View style={styles.certified}>
            <CertifiedBadge size={18} label={t('driver.status.verified')} />
            <T weight="800" color={CERTIFIED_BLUE}>{t('driver.status.verified')}</T>
          </View>
        ) : (
          <T color={colors.danger} weight="600">{t(`driver.status.${d.data.status as 'verified'}`)}</T>
        )}
        {d.data.verified_at ? <T size="sm" muted>{t('driver.validatedOn', { date: formatDate(d.data.verified_at, language, false) })}</T> : null}
        <View style={{ padding: 12, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
          <QRCode value={`KINMARCHE-LIVREUR:${d.data.driver_code}`} size={180} />
        </View>
        <T size="sm" muted>{t('driver.cardCompany')}</T>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  certified: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1.5, borderColor: CERTIFIED_GREEN, backgroundColor: 'rgba(24,119,242,0.08)',
  },
});
