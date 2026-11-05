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
