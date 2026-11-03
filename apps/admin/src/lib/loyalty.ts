// Carte Kin Marché Fidélité : libellés, messages et lecture de l'export des membres.

export type Tier = 'silver' | 'gold' | 'platinum';
export const TIERS: Tier[] = ['silver', 'gold', 'platinum'];
export const TIER_FR: Record<string, string> = { silver: 'Argent', gold: 'Gold', platinum: 'Platinum', none: 'Sans carte' };
export const CARD_STATUS_FR: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'ok' },
  suspended: { label: 'Suspendue', cls: 'bad' },
  none: { label: 'Sans carte', cls: '' },
};
export const SOURCE_FR: Record<string, string> = {
  purchase: 'Premier achat de 16 000 FC', program: 'Membre Kin Marché Fidélité (magasin)', admin: 'Émise par l’administration',
};
export const TX_FR: Record<string, string> = {
  earn: 'Points gagnés', redeem: 'Points utilisés', adjust: 'Ajustement', refund_reversal: 'Points retirés', expire: 'Points expirés',
};
export const EVENT_FR: Record<string, string> = {
  issued: 'Carte émise', tier_changed: 'Niveau modifié', suspended: 'Carte suspendue', reactivated: 'Carte réactivée',
  linked: 'Reliée à Kin Marché Fidélité', link_verified: 'Liaison vérifiée', unlinked: 'Liaison retirée',
  points_adjusted: 'Points ajustés', enroll_blocked: 'Carte non émise',
};
export const SYNC_KIND_FR: Record<string, string> = {
  enroll: 'Nouvelle carte à créer', points: 'Points', tier: 'Changement de niveau', status: 'Statut de la carte',
};

const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Action réservée à l’administration.',
  INVALID_TIER: 'Niveau inconnu.',
  USER_NOT_FOUND: 'Client introuvable.',
  PHONE_REQUIRED: 'Ce client n’a pas de numéro de téléphone valide : la carte porte son numéro (243 + 9 chiffres).',
  CARD_NUMBER_TAKEN: 'Ce numéro de téléphone est déjà celui d’une autre carte.',
  INVALID_STATUS: 'Statut inconnu.',
  NO_CARD: 'Ce client n’a pas encore de carte.',
  INVALID_POINTS: 'Nombre de points invalide (entier non nul, au plus 1 000 000).',
  NOTE_REQUIRED: 'Indiquez le motif de l’ajustement.',
  INSUFFICIENT_POINTS: 'Le solde ne peut pas devenir négatif.',
  NOT_LINKED: 'Cette carte n’est pas reliée à un membre Kin Marché Fidélité.',
  INVALID_ACTION: 'Action inconnue.',
  INVALID_ROWS: 'Fichier vide ou illisible.',
  TOO_MANY_ROWS: 'Trop de lignes en une fois.',
  INVALID_SETTING: 'Valeur de réglage invalide.',
  INVALID_SETTINGS: 'Réglages invalides.',
};

/** Message lisible d'une erreur renvoyée par les fonctions fidélité. */
export function loyaltyError(message: string | undefined | null, detail?: string | null): string {
  const m = (message ?? '').trim();
  if (m.includes('get_my_loyalty_card') || m.includes('admin_loyalty') || /Could not find the function/.test(m)) {
    return 'La carte fidélité n’est pas encore installée sur la base de données (migration 20261103000100_loyalty_cards à appliquer).';
  }
  const base = ERRORS[m] ?? m ?? 'Erreur inconnue';
  return detail ? `${base} (${detail})` : base;
}

export const points = (n: number | null | undefined) => new Intl.NumberFormat('fr-FR').format(Number(n ?? 0));

export interface ImportRow { card_number?: string; phone?: string; full_name?: string; tier?: string; points?: string; external_ref?: string }

const HEADERS: Record<keyof ImportRow, RegExp> = {
  card_number: /^(n(u|°|o)?m(e|é)ro( de)? carte|carte|card|card ?number|n° ?carte|num(e|é)ro fid(e|é)lit(e|é)|code)$/i,
  phone: /^(t(e|é)l(e|é)phone|t(e|é)l|phone|mobile|gsm|num(e|é)ro)$/i,
  full_name: /^(nom( complet)?|name|client|membre|full ?name|nom et pr(e|é)nom)$/i,
  tier: /^(niveau|tier|type( de carte)?|statut|cat(e|é)gorie|level|carte type)$/i,
  points: /^(points?|solde|solde points|balance)$/i,
  external_ref: /^(id|r(e|é)f(e|é)rence|ref|identifiant|member ?id)$/i,
};

/** Découpe une ligne CSV (séparateur ; , ou tabulation, guillemets doublés). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Lit l'export des membres (CSV ou copier-coller depuis un tableur).
 * Colonnes reconnues : numéro de carte ou téléphone, nom, niveau, points, référence.
 * Sans ligne d'en-tête : numéro ; nom ; niveau ; points.
 */
export function parseMembers(text: string): { rows: ImportRow[]; columns: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { rows: [], columns: [] };
  const first = lines[0];
  const sep = [';', '\t', ','].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(first, sep).map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const map: Partial<Record<keyof ImportRow, number>> = {};
  head.forEach((h, i) => {
    for (const [k, re] of Object.entries(HEADERS) as [keyof ImportRow, RegExp][]) {
      if (map[k] == null && re.test(h)) { map[k] = i; break; }
    }
  });
  const hasHeader = map.card_number != null || map.phone != null;
  const order: (keyof ImportRow)[] = ['card_number', 'full_name', 'tier', 'points'];
  const body = hasHeader ? lines.slice(1) : lines;
  const rows = body.map((l) => {
    const cells = splitLine(l, sep);
    const row: ImportRow = {};
    if (hasHeader) {
      for (const [k, i] of Object.entries(map) as [keyof ImportRow, number][]) if (cells[i]) row[k] = cells[i];
    } else {
      order.forEach((k, i) => { if (cells[i]) row[k] = cells[i]; });
    }
    return row;
  }).filter((r) => r.card_number || r.phone);
  const columns = hasHeader ? (Object.keys(map) as string[]) : order;
  return { rows, columns };
}
