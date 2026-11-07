import type { Currency, Language, SaleUnit } from './types';
import type { TFunction } from './i18n';

export type Rates = Partial<Record<Currency, { rate: number; updatedAt: string }>>;

const LOCALE: Record<Language, string> = { fr: 'fr-CD', en: 'en-US', ln: 'fr-CD', sw: 'sw-CD' };

/** Prix stocké en USD → affiché dans la devise choisie (si son taux existe). */
export function formatMoney(usd: number | null | undefined, currency: Currency, rates: Rates, language: Language): string {
  const value = Number(usd ?? 0);
  const rate = currency === 'USD' ? 1 : rates[currency]?.rate;
  const cur: Currency = rate ? currency : 'USD';
  const amount = value * (rate ?? 1);
  const digits = cur === 'CDF' ? 0 : 2;
  try {
    return new Intl.NumberFormat(LOCALE[language], {
      style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${cur}`;
  }
}

/** Montant déjà exprimé en francs congolais (ex. seuil d'adhésion de la carte fidélité : 16 000 FC). */
export function formatCdf(cdf: number, language: Language): string {
  try {
    return new Intl.NumberFormat(LOCALE[language], { style: 'currency', currency: 'CDF', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cdf);
  } catch {
    return `${Math.round(cdf)} FC`;
  }
}

/** Nombre de points avec séparateur de milliers. */
export function formatPoints(points: number, language: Language): string {
  try {
    return new Intl.NumberFormat(LOCALE[language]).format(points);
  } catch {
    return String(points);
  }
}

export function formatQty(qty: number, unit: SaleUnit, t: TFunction): string {
  const n = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');
  return `${n} ${t(`unit.${unit}` as 'unit.unit')}`;
}

export function formatDate(iso: string | null | undefined, language: Language, withTime = true): string {
  if (!iso) return '';
  const d = new Date(iso);
  try {
    return d.toLocaleString(LOCALE[language], withTime
      ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d.toISOString();
  }
}

/** Masque un numéro : +243 81•••••23 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const p = phone.replace(/\s/g, '');
  if (p.length < 6) return p;
  return `${p.slice(0, 6)}${'•'.repeat(Math.max(p.length - 8, 2))}${p.slice(-2)}`;
}

/** « À l'instant », « il y a 5 min », « il y a 3 h », « Hier », puis la date. */
export function timeAgo(iso: string, language: Language, t: TFunction): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.minutes', { n: min });
  const hours = Math.floor(min / 60);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (hours < 24 && d.getDate() === today.getDate()) return t('time.hours', { n: hours });
  if (d >= yesterday && d.getDate() === yesterday.getDate()) return t('time.yesterday');
  return formatDate(iso, language, false);
}

/** Taux de taxe affiché : 16 → « 16 », 16.5 → « 16,5 ». */
export function formatRate(rate: number | string | null | undefined): string {
  const n = Math.round(Number(rate ?? 0) * 100) / 100;
  return String(n).replace('.', ',');
}
