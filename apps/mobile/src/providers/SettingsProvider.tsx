import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { supabase } from '@/lib/supabase';
import { makeT, type TFunction } from '@/lib/i18n';
import { buildPalette, type BrandColors, type Palette } from '@/lib/theme';
import { formatMoney, type Rates } from '@/lib/format';
import type { Currency, Language } from '@/lib/types';

type ThemeMode = 'system' | 'light' | 'dark';

export interface Branding {
  app_name?: string;
  tagline?: string;
  logo_wide_url?: string | null;
  app_icon_url?: string | null;
  colors?: BrandColors;
}

interface SettingsValue {
  language: Language;
  currency: Currency;
  themeMode: ThemeMode;
  isDark: boolean;
  colors: Palette;
  branding: Branding;
  rates: Rates;
  selectedStoreId: string | null;
  t: TFunction;
  money: (usd: number | null | undefined) => string;
  setLanguage: (l: Language) => void;
  setCurrency: (c: Currency) => void;
  setThemeMode: (m: ThemeMode) => void;
  setSelectedStoreId: (id: string | null) => void;
  reloadRemote: () => Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);
const KEY = 'km.settings.v1';

// Lecture/écriture locale protégée : ne doit jamais bloquer l'application.
async function readLocal(): Promise<Partial<{ language: Language; currency: Currency; themeMode: ThemeMode; selectedStoreId: string | null }>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function deviceLanguage(): Language {
  try {
    const code = getLocales()[0]?.languageCode;
    if (code === 'en' || code === 'sw' || code === 'ln') return code;
  } catch {
    /* ignore */
  }
  return 'fr';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [language, setLanguageState] = useState<Language>(deviceLanguage());
  const [currency, setCurrencyState] = useState<Currency>('USD');
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [selectedStoreId, setSelectedStoreIdState] = useState<string | null>(null);
  const [branding, setBranding] = useState<Branding>({});
  const [rates, setRates] = useState<Rates>({ USD: { rate: 1, updatedAt: new Date().toISOString() } });

  useEffect(() => {
    readLocal().then((s) => {
      if (s.language) setLanguageState(s.language);
      if (s.currency) setCurrencyState(s.currency);
      if (s.themeMode) setThemeModeState(s.themeMode);
      if (s.selectedStoreId !== undefined) setSelectedStoreIdState(s.selectedStoreId);
    });
  }, []);

  const persist = useCallback((patch: Record<string, unknown>) => {
    readLocal()
      .then((cur) => AsyncStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch })))
      .catch(() => undefined);
  }, []);

  const reloadRemote = useCallback(async () => {
    const [settingsRes, ratesRes] = await Promise.all([
      supabase.from('app_settings').select('key, value').in('key', ['branding']),
      supabase.from('exchange_rates').select('currency, rate_per_usd, updated_at'),
    ]);
    const b = settingsRes.data?.find((r) => r.key === 'branding');
    if (b) setBranding(b.value as Branding);
    if (ratesRes.data) {
      const next: Rates = {};
      for (const r of ratesRes.data) next[r.currency as Currency] = { rate: Number(r.rate_per_usd), updatedAt: r.updated_at };
      setRates(next);
    }
  }, []);

  useEffect(() => {
    reloadRemote().catch(() => undefined);
  }, [reloadRemote]);

  const isDark = themeMode === 'dark' || (themeMode === 'system' && scheme === 'dark');
  const colors = useMemo(() => buildPalette(isDark, branding.colors), [isDark, branding.colors]);
  const t = useMemo(() => makeT(language), [language]);
  const money = useCallback((usd: number | null | undefined) => formatMoney(usd, currency, rates, language), [currency, rates, language]);

  const value: SettingsValue = {
    language, currency, themeMode, isDark, colors, branding, rates, selectedStoreId, t, money, reloadRemote,
    setLanguage: (l) => { setLanguageState(l); persist({ language: l }); },
    setCurrency: (c) => { setCurrencyState(c); persist({ currency: c }); },
    setThemeMode: (m) => { setThemeModeState(m); persist({ themeMode: m }); },
    setSelectedStoreId: (id) => { setSelectedStoreIdState(id); persist({ selectedStoreId: id }); },
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings doit être utilisé dans SettingsProvider');
  return ctx;
}
