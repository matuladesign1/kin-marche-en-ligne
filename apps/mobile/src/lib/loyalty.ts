import type { LoyaltyTier } from './types';

/**
 * Numéro de carte Kin Marché Fidélité à partir d'un téléphone saisi librement
 * (+243 81 234 5678, 0812345678, 00243…, 812345678 -> 243812345678).
 * Même règle que public.km_card_number côté serveur.
 */
export function cardNumberFromPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (/^243\d{9}$/.test(d)) return d;
  if (/^00243\d{9}$/.test(d)) return d.slice(2);
  if (/^0\d{9}$/.test(d)) return `243${d.slice(1)}`;
  if (/^[1-9]\d{8}$/.test(d)) return `243${d}`;
  return null;
}

/** Téléphone au format international enregistré dans le profil (+243…), ou null s'il n'est pas valide. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const n = cardNumberFromPhone(phone);
  return n ? `+${n}` : null;
}

export const TIERS: LoyaltyTier[] = ['silver', 'gold', 'platinum'];

export function isTier(t: string | null | undefined): t is LoyaltyTier {
  return t === 'silver' || t === 'gold' || t === 'platinum';
}

/** Clé de stockage : la carte de bienvenue n'est montrée qu'une fois par compte. */
export const welcomeKey = (userId: string) => `km.loyaltyWelcome.${userId}`;
