import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch } from 'react-native';
import { Card, Notice, Row, Screen, SectionHeader, T } from '@/components/ui';
import { LEGAL_EN, LEGAL_FR, type LegalDoc } from '@/legal';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const DOCS: LegalDoc[] = ['terms', 'license', 'privacy', 'cookies'];

function CookiePreferences() {
  const { t, colors } = useSettings();
  const { session } = useAuth();
  const [prefs, setPrefs] = useState<{ notify_promotions: boolean; share_usage_statistics: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session) return;
    supabase.from('customer_profiles').select('notify_promotions, share_usage_statistics').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => setPrefs((data as typeof prefs) ?? { notify_promotions: true, share_usage_statistics: false }));
  }, [session]);

  if (!session || !prefs) return null;
  const update = async (patch: Partial<NonNullable<typeof prefs>>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const { error } = await supabase.from('customer_profiles').update(patch).eq('user_id', session.user.id);
    setSaved(!error);
    if (error) setPrefs(prefs);
  };

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <T style={{ flex: 1 }}>{t('privacy.promotions')}</T>
        <Switch value={prefs.notify_promotions} onValueChange={(v) => update({ notify_promotions: v })} trackColor={{ true: colors.primary }} />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <T style={{ flex: 1 }}>{t('privacy.statistics')}</T>
        <Switch value={prefs.share_usage_statistics} onValueChange={(v) => update({ share_usage_statistics: v })} trackColor={{ true: colors.primary }} />
      </Row>
      {saved ? <T size="xs" color={colors.success}>{t('privacy.saved')}</T> : null}
    </Card>
  );
}

export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { t, language } = useSettings();
  const key: LegalDoc = DOCS.includes(doc as LegalDoc) ? (doc as LegalDoc) : 'terms';
  // Le français fait foi ; l'anglais est fourni pour information. Lingala et swahili : texte français officiel.
  const text = (language === 'en' ? LEGAL_EN : LEGAL_FR)[key];

  return (
    <Screen>
      <Stack.Screen options={{ title: text.title }} />
      <T size="xl" weight="700">{text.title}</T>
      <T size="xs" muted>{text.updated}</T>
      {key === 'cookies' ? <CookiePreferences /> : null}
      {text.sections.map((s) => (
        <Card key={s.title}>
          <SectionHeader title={s.title} />
          <T>{s.body}</T>
        </Card>
      ))}
      <Notice text={t('account.legalReview')} />
    </Screen>
  );
}
