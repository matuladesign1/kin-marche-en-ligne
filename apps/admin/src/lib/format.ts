export const usd = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('fr-CD', { style: 'currency', currency: 'USD' }).format(Number(n ?? 0));

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'short', timeStyle: 'short' }) : '';

export const STATUS_FR: Record<string, string> = {
  received: 'Commande reçue', payment_confirmed: 'Paiement confirmé', sent_to_store: 'Transmise au magasin',
  preparing: 'Préparation', verified: 'Produits vérifiés', packed: 'Colis emballés', ready: 'Prête',
  driver_assigned: 'Livreur assigné', driver_to_store: 'Livreur en route (magasin)', picked_up: 'Colis récupérés',
  in_delivery: 'Livraison en cours', driver_near: 'Livreur proche', driver_arrived: 'Livreur arrivé',
  recipient_check: 'Vérification destinataire', delivered: 'Livrée', completed: 'Terminée',
  cancelled: 'Annulée', failed: 'Échec livraison', refunded: 'Remboursée',
};

export const PAY_FR: Record<string, string> = {
  pending: 'En attente', processing: 'En cours', succeeded: 'Payée', failed: 'Échec',
  cancelled: 'Annulée', refunded: 'Remboursée', partially_refunded: 'Part. remboursée',
};

/** Étape suivante que le magasin peut valider. */
export const STORE_NEXT: Record<string, { to: string; label: string }> = {
  sent_to_store: { to: 'preparing', label: 'Commencer la préparation' },
  preparing: { to: 'verified', label: 'Produits vérifiés' },
  verified: { to: 'packed', label: 'Colis emballés' },
  packed: { to: 'ready', label: 'Commande prête (appeler un livreur)' },
};

export const UNIT_FR: Record<string, string> = {
  unit: 'pièce', kg: 'kg', g: 'g', litre: 'litre', ml: 'ml', pack: 'paquet', carton: 'carton',
};
