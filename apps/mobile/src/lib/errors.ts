import type { TFunction, TranslationKey } from './i18n';
import fr from '@/locales/fr';

/**
 * Les fonctions serveur lèvent des codes (ex. OUT_OF_STOCK) ou renvoient des
 * « issues » (ex. BELOW_MIN_ORDER:10). On les traduit ici.
 */
export function translateIssue(issue: string, t: TFunction): string {
  const [code, hint] = issue.split(':');
  if (code === 'OUT_OF_STOCK' && hint) return `${t('err.OUT_OF_STOCK')} (${hint})`;
  const key = `err.${code}` as TranslationKey;
  if (key in fr) return t(key, { hint: hint ?? '' });
  return issue;
}

export function errorMessage(e: unknown, t: TFunction): string {
  if (!e) return t('common.error');
  const err = e as { message?: string; hint?: string | null; details?: string | null };
  const msg = err.message ?? String(e);
  if (/network|fetch|Failed to fetch/i.test(msg)) return t('err.network');
  if (msg === 'ORDER_NOT_POSSIBLE' && err.details) {
    try {
      const issues = JSON.parse(err.details) as string[];
      return issues.map((i) => translateIssue(i, t)).join('\n');
    } catch {
      /* ignore */
    }
  }
  const key = `err.${msg}` as TranslationKey;
  if (key in fr) return t(key, { hint: err.hint ?? '' });
  return msg || t('common.error');
}
