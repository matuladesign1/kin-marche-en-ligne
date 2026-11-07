// Libellés partagés des campagnes (administration web) : utilisés côté serveur et dans le formulaire.

export const AUDIENCES: Record<string, string> = {
  all: 'Tous les clients',
  buyers: 'Clients ayant déjà commandé',
  new: 'Nouveaux clients (aucune commande)',
  lapsed: 'Clients inactifs depuis 30 jours',
  city: 'Clients d’une ville',
};

export const LINKS: Record<string, string> = {
  promotion: 'Page des promotions', product: 'Un produit', category: 'Une catégorie', url: 'Un site web',
};

export type Audiences = {
  segments: Partial<Record<'all' | 'buyers' | 'new' | 'lapsed', { customers: number; phone: number; email: number }>>;
  cities: { city: string; customers: number }[];
};
export type ChannelState = { email: boolean; whatsapp: boolean; push_devices: number };
