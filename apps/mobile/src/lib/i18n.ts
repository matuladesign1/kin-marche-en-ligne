import fr, { type TranslationKey } from '@/locales/fr';
import en from '@/locales/en';
import sw from '@/locales/sw';
import ln from '@/locales/ln';
import type { Language } from './types';

const dictionaries: Record<Language, Partial<Record<TranslationKey, string>>> = { fr, en, sw, ln };

export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function makeT(language: Language): TFunction {
  const dict = dictionaries[language] ?? fr;
  return (key, params) => {
    let text: string = dict[key] ?? fr[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
    }
    return text;
  };
}

/** Nom localisé d'un objet {fr, en, ln, sw}. */
export function localized(value: Partial<Record<Language, string>> | null | undefined, language: Language, fallback = ''): string {
  if (!value) return fallback;
  return value[language] || value.fr || value.en || fallback;
}

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'ln', label: 'Lingala' },
  { code: 'sw', label: 'Kiswahili' },
];

export type { TranslationKey };
