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
