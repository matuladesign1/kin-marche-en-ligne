import type { TFunction, TranslationKey } from './i18n';
import type { Language, OrderStatus, PastryCategory, PastryOrder, PastryStatus } from './types';

// Pâtisserie Kin Marché : couleurs de l'espace (chocolat, framboise, crème, caramel, pistache),
// catégories, étapes et créneaux horaires des commandes.

export const PASTRY = {
  choco: '#3B2320',
  chocoDeep: '#22130F',
  raspberry: '#E0457B',
  raspberryDeep: '#B92D61',
  cream: '#FFF4E8',
  caramel: '#E2A45B',
  pistachio: '#6DB35A',
  vanilla: '#F7E7CE',
  cocoaText: '#D9C2B4',
} as const;

export const PASTRY_CATEGORIES: PastryCategory[] = ['cake', 'bread', 'viennoiserie', 'other'];

/** Icône (MaterialCommunityIcons) et couleur de chaque catégorie. */
export const CATEGORY_LOOK: Record<PastryCategory, { icon: 'cake-variant' | 'baguette' | 'food-croissant' | 'cupcake'; tint: string }> = {
  cake: { icon: 'cake-variant', tint: PASTRY.raspberry },
  bread: { icon: 'baguette', tint: '#C27C2C' },
  viennoiserie: { icon: 'food-croissant', tint: '#D98A1E' },
  other: { icon: 'cupcake', tint: '#8B5CF6' },
};

/** Parcours d'une demande, vu par le client. */
export const PASTRY_FLOW: PastryStatus[] = ['submitted', 'quoted', 'accepted', 'paid', 'in_preparation', 'ready', 'delivering', 'delivered'];

export function statusTone(status: PastryStatus): 'new' | 'wait' | 'pay' | 'work' | 'done' | 'stop' {
  switch (status) {
    case 'submitted': return 'new';
    case 'quoted': return 'wait';
    case 'accepted': return 'pay';
    case 'paid': case 'in_preparation': case 'ready': case 'delivering': return 'work';
    case 'delivered': return 'done';
    default: return 'stop';
  }
}

export const TONE_COLOR: Record<ReturnType<typeof statusTone>, string> = {
  new: PASTRY.raspberry,
  wait: '#D98A1E',
  pay: '#0097FC',
  work: '#8B5CF6',
  done: '#13A35F',
  stop: '#8A8F98',
};

export function statusLabel(status: PastryStatus, t: TFunction): string {
  return t(`pastry.status.${status}` as TranslationKey);
}

/** Liste « a|b|c » d'une traduction. */
export function listOf(t: TFunction, key: TranslationKey): string[] {
  return t(key).split('|').map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------
// Créneaux : jours à venir et heures possibles (de 7 h à 20 h, toutes les 30 minutes),
// au plus tôt « délai minimum » heures après maintenant.
// ---------------------------------------------------------------------
export const OPEN_HOUR = 7;
export const LAST_HOUR = 20;
export const STEP_MINUTES = 30;
export const DAYS_AHEAD = 21;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function nextDays(count = DAYS_AHEAD, now = new Date()): Date[] {
  const today = startOfDay(now);
  return Array.from({ length: count }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
}

/** Heures possibles d'un jour, en tenant compte du délai minimum. */
export function timeSlots(day: Date, leadHours: number, now = new Date()): Date[] {
  const earliest = now.getTime() + leadHours * 3_600_000;
  const out: Date[] = [];
  for (let h = OPEN_HOUR; h <= LAST_HOUR; h++) {
    for (let m = 0; m < 60; m += STEP_MINUTES) {
      if (h === LAST_HOUR && m > 0) break;
      const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (slot.getTime() >= earliest) out.push(slot);
    }
  }
  return out;
}

const LOCALE: Record<Language, string> = { fr: 'fr-CD', en: 'en-US', ln: 'fr-CD', sw: 'sw-CD' };

function localeDate(d: Date, language: Language, opts: Intl.DateTimeFormatOptions): string {
  try {
    return d.toLocaleDateString(LOCALE[language] ?? 'fr-CD', opts).replace('.', '');
  } catch {
    return opts.weekday ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}

export function dayLabel(d: Date, language: Language, t: TFunction, now = new Date()): { top: string; bottom: string } {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  const weekday = localeDate(d, language, { weekday: 'short' });
  const date = localeDate(d, language, { day: 'numeric', month: 'short' });
  if (diff === 0) return { top: t('pastry.today'), bottom: date };
  if (diff === 1) return { top: t('pastry.tomorrow'), bottom: date };
  return { top: weekday.charAt(0).toUpperCase() + weekday.slice(1), bottom: date };
}

export function timeLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** « Sam. 14 nov. · 15:00 », ou « Dès que possible ». */
export function desiredLabel(iso: string | null | undefined, language: Language, t: TFunction): string {
  if (!iso) return t('pastry.forAsap');
  const d = new Date(iso);
  const { top, bottom } = dayLabel(d, language, t);
  return `${top} ${bottom} · ${timeLabel(d)}`;
}

/** Livraison souhaitée dans moins de 6 heures (ou déjà passée) : commande urgente pour le pâtissier. */
export function isUrgent(o: Pick<PastryOrder, 'desired_at' | 'status'>, now = Date.now()): boolean {
  if (!o.desired_at || ['delivered', 'rejected', 'cancelled', 'delivering'].includes(o.status)) return false;
  return new Date(o.desired_at).getTime() - now < 6 * 3_600_000;
}

// ---------------------------------------------------------------------
// Étapes de préparation (commande payée) : le pâtissier fait avancer la commande Kin Marché liée.
// ---------------------------------------------------------------------
export type PrepStep = 'preparing' | 'verified' | 'packed' | 'ready' | 'driver' | 'delivered';
export const PREP_STEPS: PrepStep[] = ['preparing', 'verified', 'packed', 'ready', 'driver', 'delivered'];

const DRIVER_STATUSES: OrderStatus[] = ['driver_assigned', 'driver_to_store', 'picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check'];

/** Rang atteint dans les étapes (−1 : pas encore commencé). */
export function prepRank(orderStatus: OrderStatus | null | undefined): number {
  if (!orderStatus) return -1;
  if (orderStatus === 'delivered' || orderStatus === 'completed') return 5;
  if (DRIVER_STATUSES.includes(orderStatus)) return 4;
  const i = (['preparing', 'verified', 'packed', 'ready'] as OrderStatus[]).indexOf(orderStatus);
  return i;
}

/** Prochaine étape que le pâtissier peut valider. */
export function nextPrepStatus(orderStatus: OrderStatus | null | undefined): 'preparing' | 'verified' | 'packed' | 'ready' | null {
  switch (orderStatus) {
    case 'sent_to_store': return 'preparing';
    case 'preparing': return 'verified';
    case 'verified': return 'packed';
    case 'packed': return 'ready';
    default: return null;
  }
}

/** Champs nécessaires pour un profil complet (certification). */
export function profileChecklist(c: {
  display_name?: string | null; birth_date?: string | null; id_type?: string | null; id_number?: string | null;
  id_photo_path?: string | null; address?: string | null; commune?: string | null; specialties?: string[] | null;
} | null | undefined, phone: string | null | undefined): { done: number; total: number } {
  const items = [
    !!c?.display_name?.trim(), !!c?.birth_date, !!c?.id_type, !!c?.id_number?.trim(), !!c?.id_photo_path,
    !!c?.address?.trim(), !!c?.commune?.trim(), !!phone?.trim(), (c?.specialties?.length ?? 0) > 0,
  ];
  return { done: items.filter(Boolean).length, total: items.length };
}

/** « JJ/MM/AAAA » → « AAAA-MM-JJ » (null si invalide). */
export function parseBirthDate(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatBirthDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}
