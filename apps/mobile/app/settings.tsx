import { Card, Chip, Row, Screen, SectionHeader, T } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import type { Currency } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

const CURRENCIES: { code: Currency; label: string }[] = [
  { code: 'USD', label: 'USD — Dollar américain' },
  { code: 'CDF', label: 'CDF — Franc congolais' },
  { code: 'EUR', label: 'EUR — Euro' },
];

export default function Settings() {
  const { t, language, setLanguage, currency, setCurrency, themeMode, setThemeMode, rates } = useSettings();
  const { session } = useAuth();

  const saveRemote = (patch: Record<string, string>) => {
    if (session) supabase.from('profiles').update(patch).eq('id', session.user.id).then(() => undefined);
  };

  return (
    <Screen>
      <SectionHeader title={t('settings.language')} />
      <Row style={{ flexWrap: 'wrap' }}>
        {LANGUAGES.map((l) => (
          <Chip key={l.code} label={l.label} active={language === l.code} onPress={() => { setLanguage(l.code); saveRemote({ language: l.code }); }} />
        ))}
      </Row>

      <SectionHeader title={t('settings.currency')} />
      {CURRENCIES.map((c) => {
        const r = rates[c.code];
        const available = c.code === 'USD' || !!r;
        return (
          <Card key={c.code} onPress={available ? () => { setCurrency(c.code); saveRemote({ currency: c.code }); } : undefined}
            style={currency === c.code ? { borderWidth: 2 } : { opacity: available ? 1 : 0.5 }}>
            <T weight={currency === c.code ? '700' : '400'}>{c.label}</T>
            {c.code !== 'USD' ? (
              <T size="xs" muted>
                {r ? t('settings.rateDate', { date: formatDate(r.updatedAt, language), rate: r.rate, cur: c.code }) : t('settings.rateMissing')}
              </T>
            ) : null}
          </Card>
        );
      })}

      <SectionHeader title={t('settings.theme')} />
      <Row>
        {(['system', 'light', 'dark'] as const).map((m) => (
          <Chip key={m} label={t(`settings.theme.${m}`)} active={themeMode === m} onPress={() => setThemeMode(m)} />
        ))}
      </Row>
    </Screen>
  );
}
