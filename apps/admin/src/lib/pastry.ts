// Pâtisserie : libellés communs à l'administration générale et à l'espace supermarché.

export const PASTRY_STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Nouvelle demande', cls: 'warn' },
  quoted: { label: 'Prix proposé', cls: 'info' },
  accepted: { label: 'Prix accepté — à payer', cls: 'info' },
  paid: { label: 'Payée — à préparer', cls: 'ok' },
  in_preparation: { label: 'En préparation', cls: 'ok' },
  ready: { label: 'Prête — livreur', cls: 'ok' },
  delivering: { label: 'En livraison', cls: 'ok' },
  delivered: { label: 'Livrée', cls: 'ok' },
  rejected: { label: 'Refusée', cls: 'bad' },
  cancelled: { label: 'Annulée', cls: 'bad' },
};

export const PASTRY_FILTERS: Record<string, { label: string; statuses: string[] }> = {
  todo: { label: 'À traiter', statuses: ['submitted'] },
  quoted: { label: 'Prix envoyés', statuses: ['quoted', 'accepted'] },
  prep: { label: 'À préparer', statuses: ['paid', 'in_preparation'] },
  ready: { label: 'Prêtes / livraison', statuses: ['ready', 'delivering'] },
  done: { label: 'Livrées', statuses: ['delivered'] },
  stopped: { label: 'Refusées / annulées', statuses: ['rejected', 'cancelled'] },
};

export const CATEGORY: Record<string, string> = { cake: 'Gâteau', bread: 'Pain', viennoiserie: 'Viennoiserie', other: 'Autre' };
export const GENDER: Record<string, string> = { female: 'Femme', male: 'Homme', other: 'Autre' };
export const ID_TYPE: Record<string, string> = { voter_card: 'Carte d’électeur', passport: 'Passeport', driver_license: 'Permis de conduire', other: 'Autre pièce' };

export const PASTRY_ERRORS: Record<string, string> = {
  FORBIDDEN: 'Action non autorisée pour ce compte ou ce supermarché.',
  USER_NOT_FOUND: 'Aucun compte avec cet e-mail : la personne doit d’abord créer son compte dans l’application Kin Marché.',
  ROLE_CONFLICT: 'Ce compte a déjà un autre rôle (livreur, directeur, agent ou administrateur) : il ne peut pas devenir pâtissier.',
  CHEF_OTHER_STORE: 'Ce pâtissier travaille déjà pour un autre supermarché que vous ne gérez pas.',
  CHEF_NOT_FOUND: 'Pâtissier introuvable.',
  PROFILE_INCOMPLETE: 'Profil incomplet : le pâtissier doit d’abord renseigner son identité, sa pièce d’identité, son adresse et ses spécialités.',
  STATUS_INVALID: 'Statut non valable.',
  INVALID_LEAD: 'Délai minimum entre 0 et 72 heures.',
  REASON_REQUIRED: 'Indiquez le motif (il est envoyé au client).',
  TRANSITION_NOT_ALLOWED: 'Cette action n’est plus possible à cette étape.',
  ALREADY_TAKEN: 'Un autre pâtissier s’occupe de cette commande.',
  PASTRY_NOT_CANCELLABLE: 'Cette commande ne peut plus être annulée (déjà payée ou terminée).',
  PAYMENT_IN_PROGRESS: 'Un paiement est en cours pour cette commande : annulation impossible.',
  PASTRY_ORDER_NOT_FOUND: 'Commande pâtisserie introuvable.',
};

export function pastryError(message: string): string {
  return PASTRY_ERRORS[message] ?? message;
}

/** Âge en années à partir d'une date « AAAA-MM-JJ ». */
export function ageOf(birth: string | null | undefined): number | null {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** « 14/11/2026 15:00 » (heure de Kinshasa) ou « Dès que possible ». */
export function desired(iso: string | null | undefined): string {
  if (!iso) return 'Dès que possible';
  return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Champs nécessaires à la certification (mêmes règles que la base). */
export function completion(c: Record<string, any>, phone: string | null | undefined): { done: number; total: number; missing: string[] } {
  const items: [string, boolean][] = [
    ['nom affiché', !!c.display_name?.trim()],
    ['date de naissance', !!c.birth_date],
    ['type de pièce', !!c.id_type],
    ['numéro de pièce', !!c.id_number?.trim()],
    ['photo de la pièce', !!c.id_photo_path],
    ['adresse', !!c.address?.trim()],
    ['commune', !!c.commune?.trim()],
    ['téléphone', !!phone?.trim()],
    ['spécialités', (c.specialties?.length ?? 0) > 0],
  ];
  return { done: items.filter(([, ok]) => ok).length, total: items.length, missing: items.filter(([, ok]) => !ok).map(([l]) => l) };
}
