// Roue de la chance : libellés et messages d'erreur de l'administration.

export const KIND_FR: Record<string, string> = {
  points: 'Points fidélité',
  coupon_percent: 'Code promo (%)',
  coupon_fixed: 'Code promo ($)',
  product: 'Cadeau (produit)',
  extra_spin: 'Tour supplémentaire',
  nothing: 'Pas de chance',
};

export const KIND_ORDER = ['points', 'coupon_percent', 'coupon_fixed', 'product', 'extra_spin', 'nothing'] as const;

export const REWARD_STATUS_FR: Record<string, string> = {
  pending: 'Cadeau à remettre',
  attached: 'Joint à une commande',
  delivered: 'Remis',
  credited: 'Crédité',
  issued: 'Code créé',
  cancelled: 'Annulé',
};

export const REWARD_STATUS_TONE: Record<string, string> = {
  pending: 'warn', attached: 'info', delivered: 'ok', credited: 'ok', issued: 'info', cancelled: 'bad',
};

const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Action réservée à l’administrateur général.',
  INVALID_SETTINGS: 'Réglages invalides : montant ≥ 0, 1 à 10 tours par commande, validités de 1 à 365 jours.',
  INVALID_WHEEL_DATES: 'Dates invalides : la date de fin doit être après la date de début.',
  INVALID_PRIZE: 'Lot invalide : vérifiez le poids, le stock et le montant minimum.',
  INVALID_PRIZE_KIND: 'Type de lot inconnu.',
  INVALID_PRIZE_LABEL: 'Le libellé doit faire de 1 à 40 caractères (il s’affiche sur la roue).',
  INVALID_PRIZE_VALUE: 'Valeur invalide : points entiers ≥ 1, pourcentage entre 1 et 100, montant en $ > 0.',
  INVALID_PRIZE_PRODUCT: 'Choisissez le produit offert.',
  INVALID_PRIZE_COLOR: 'Couleur invalide (format #RRGGBB).',
  PRIZE_NOT_FOUND: 'Lot introuvable.',
  REWARD_NOT_FOUND: 'Gain introuvable.',
  REWARD_STATE: 'Ce gain ne peut plus être modifié de cette façon.',
  INVALID_ACTION: 'Action inconnue.',
  INVALID_COUNT: 'Nombre de tours : de 1 à 20.',
  CUSTOMER_NOT_FOUND: 'Aucun client avec cet e-mail ou ce téléphone.',
  CUSTOMER_AMBIGUOUS: 'Plusieurs clients correspondent : précisez l’e-mail.',
};

export function wheelError(message: string | undefined | null): string {
  const m = (message ?? '').trim();
  if (/wheel|Could not find the function/.test(m) && !ERRORS[m]) {
    return 'La Roue de la chance n’est pas encore installée sur la base de données (migration 20261105000100_wheel_notifications à appliquer).';
  }
  return ERRORS[m] ?? (m || 'Erreur inconnue');
}

// ── Période de la roue (heure de Kinshasa, UTC+1 toute l'année) ────────────────
export const KIN_TZ = 'Africa/Kinshasa';

/** Valeur d'un champ « date et heure » (heure de Kinshasa) → date ISO ; vide → chaîne vide (= sans limite). */
export function kinLocalToIso(value: string): string {
  const v = value.trim();
  if (!v) return '';
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+01:00` : v;
}

/** Date ISO → valeur d'un champ « date et heure » en heure de Kinshasa. */
export function isoToKinLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** « 31 décembre 2026 à 23:59 » (heure de Kinshasa). */
export function formatKin(iso?: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: KIN_TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

export type WheelState = 'active' | 'off' | 'upcoming' | 'ended';

/** État de la roue en une phrase, avec sa période. */
export function wheelStateText(state: WheelState, startsAt?: string | null, endsAt?: string | null): { text: string; tone: string } {
  switch (state) {
    case 'off': return { text: 'Désactivée : la roue n’apparaît pas dans l’application.', tone: 'bad' };
    case 'upcoming': return { text: `Programmée : elle s’ouvrira le ${formatKin(startsAt)}${endsAt ? ` et se fermera le ${formatKin(endsAt)}` : ''}.`, tone: 'warn' };
    case 'ended': return { text: `Terminée depuis le ${formatKin(endsAt)} : elle a disparu de l’application.`, tone: 'bad' };
    default: return { text: endsAt ? `En cours jusqu’au ${formatKin(endsAt)}.` : 'En cours, sans date de fin.', tone: 'ok' };
  }
}

/** Description lisible de la valeur d'un lot. */
export function prizeValue(p: { kind: string; value: number | string; min_order_usd?: number | string | null; product_name?: string | null; quantity?: number }): string {
  const v = Number(p.value);
  const min = Number(p.min_order_usd ?? 0);
  switch (p.kind) {
    case 'points': return `${v} points`;
    case 'coupon_percent': return `-${v} %${min ? ` dès ${min} $` : ''}`;
    case 'coupon_fixed': return `-${v} $${min ? ` dès ${min} $` : ''}`;
    case 'product': return `${p.quantity && p.quantity > 1 ? `${p.quantity} × ` : ''}${p.product_name ?? 'produit'}`;
    case 'extra_spin': return 'Relance gratuite';
    default: return '—';
  }
}
