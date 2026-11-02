// Textes juridiques — version 1.0 du 2 novembre 2026.
// À faire valider par le service juridique de Kin Marché / Groupe BNB avant publication sur les stores.
export type LegalDoc = 'terms' | 'license' | 'privacy' | 'cookies';
export interface LegalSection { title: string; body: string }
export interface LegalText { title: string; updated: string; sections: LegalSection[] }

const COMPANY = 'Kin Marché (Groupe BNB), Kinshasa, République Démocratique du Congo';
const CONTACT = 'MATULA DESIGN — +243 849 009 239 — omalbac@gmail.com';

export const LEGAL_FR: Record<LegalDoc, LegalText> = {
  terms: {
    title: 'Conditions générales d’utilisation',
    updated: 'Version 1.0 — 2 novembre 2026',
    sections: [
      { title: '1. Objet', body: `Les présentes conditions encadrent l’utilisation de l’application « Kin Marché en ligne », éditée pour ${COMPANY}. Elles permettent de consulter les produits des supermarchés Kin Marché, de commander, de payer en ligne et de se faire livrer.` },
      { title: '2. Compte client', body: 'La création d’un compte est gratuite. Vous êtes responsable de l’exactitude de vos informations et de la confidentialité de votre mot de passe. Kin Marché peut suspendre un compte en cas d’utilisation frauduleuse ou abusive.' },
      { title: '3. Commandes', body: 'Chaque commande est préparée par un seul supermarché Kin Marché. Les prix affichés sont ceux du supermarché au moment de la commande ; le total (produits, frais de livraison, réductions) est calculé par nos serveurs et affiché avant validation. Les produits sont réservés pendant le délai de paiement indiqué.' },
      { title: '4. Paiement', body: 'Le paiement à la livraison n’est pas accepté. Toute commande est payée dans l’application, via un prestataire agréé (Mobile Money, carte bancaire, virement). Une commande n’est considérée comme payée qu’après confirmation du prestataire ou vérification de la preuve de paiement par Kin Marché. Kin Marché ne conserve jamais vos numéros de carte ni vos codes PIN.' },
      { title: '5. Livraison', body: 'La livraison est assurée par des livreurs vérifiés par Kin Marché. Un code de livraison vous est communiqué dans l’application : ne le donnez au livreur qu’au moment de recevoir votre colis. Les délais affichés sont des estimations calculées à partir des données de navigation.' },
      { title: '6. Annulation, retours et remboursements', body: 'Une commande non payée peut être annulée depuis l’application. Une commande payée ne peut plus être annulée librement : contactez l’assistance. Les produits manquants, endommagés ou non conformes signalés à la livraison donnent lieu à un remplacement ou à un remboursement selon la politique de Kin Marché.' },
      { title: '7. Avis', body: 'Seuls les clients ayant reçu une commande peuvent publier un avis. Les avis sont modérés ; les propos injurieux, discriminatoires ou trompeurs sont refusés.' },
      { title: '8. Responsabilité', body: 'Kin Marché met tout en œuvre pour assurer la disponibilité de l’application, sans pouvoir garantir une absence totale d’interruption. Les photos de produits sont indicatives.' },
      { title: '9. Droit applicable', body: 'Les présentes conditions sont soumises au droit de la République Démocratique du Congo. Tout litige sera, à défaut d’accord amiable, porté devant les juridictions compétentes de Kinshasa.' },
      { title: '10. Contact', body: `Assistance : messagerie de l’application. Éditeur technique : ${CONTACT}.` },
    ],
  },
  license: {
    title: 'Termes de licence d’utilisation',
    updated: 'Version 1.0 — 2 novembre 2026',
    sections: [
      { title: '1. Licence accordée', body: 'Kin Marché vous accorde une licence personnelle, gratuite, non exclusive et non transférable d’utilisation de l’application sur vos appareils, pour un usage privé.' },
      { title: '2. Restrictions', body: 'Il est interdit de copier, modifier, décompiler, revendre ou distribuer l’application, de contourner ses mesures de sécurité, ou de l’utiliser pour collecter des données d’autres utilisateurs.' },
      { title: '3. Propriété intellectuelle', body: 'Le nom et le logo Kin Marché, le slogan « Au prix du Grand Marché », les textes, visuels et le logiciel restent la propriété de Kin Marché (Groupe BNB) et de leurs auteurs. Le développement est assuré par MATULA DESIGN.' },
      { title: '4. Mises à jour', body: 'Des mises à jour peuvent être proposées pour corriger des erreurs ou ajouter des fonctionnalités. Certaines peuvent être nécessaires pour continuer à utiliser le service.' },
      { title: '5. Fin de la licence', body: 'La licence prend fin lorsque vous supprimez votre compte ou désinstallez l’application, ou en cas de non-respect des présents termes.' },
    ],
  },
  privacy: {
    title: 'Politique de confidentialité',
    updated: 'Version 1.0 — 2 novembre 2026',
    sections: [
      { title: '1. Responsable', body: `${COMPANY}. Contact pour vos données : messagerie de l’application ou ${CONTACT}.` },
      { title: '2. Données collectées', body: 'Identité et contact (nom, e-mail, téléphone, photo de profil si vous l’ajoutez), adresses de livraison et position GPS si vous l’autorisez, commandes et paiements (sans numéro de carte ni code PIN), messages échangés avec l’assistance, avis, jeton de notification de votre téléphone.' },
      { title: '3. Utilisation', body: 'Exécuter vos commandes et livraisons, vérifier les paiements, vous informer de l’avancement, gérer la fidélité et les coupons, répondre à vos demandes, prévenir la fraude, établir les comptes et statistiques internes. Aucune donnée n’est vendue.' },
      { title: '4. Partage', body: 'Le supermarché qui prépare votre commande et le livreur assigné voient uniquement ce qui est nécessaire (nom, téléphone, adresse de livraison) pendant la commande. Le livreur ne voit jamais votre code de livraison. Les prestataires techniques (hébergement Supabase, cartes Google, notifications Expo, prestataires de paiement) traitent les données pour notre compte.' },
      { title: '5. Position', body: 'Votre position n’est utilisée que lorsque vous l’autorisez, pour trouver le supermarché qui peut vous livrer et enregistrer une adresse précise.' },
      { title: '6. Conservation', body: 'Les données de compte sont conservées tant que le compte est actif. À la suppression du compte, vos données personnelles sont effacées ; les commandes et écritures financières sont conservées sous forme anonyme pendant la durée légale.' },
      { title: '7. Sécurité', body: 'Les accès sont chiffrés et cloisonnés : chaque client ne voit que ses propres données, chaque supermarché uniquement les siennes. Les documents sensibles sont stockés dans des espaces privés.' },
      { title: '8. Vos droits', body: 'Vous pouvez consulter et modifier vos informations dans « Mon compte », gérer vos autorisations et préférences, et supprimer votre compte à tout moment depuis l’application.' },
    ],
  },
  cookies: {
    title: 'Préférences de cookies et traceurs',
    updated: 'Version 1.0 — 2 novembre 2026',
    sections: [
      { title: 'Ce que l’application enregistre', body: 'L’application mobile n’utilise pas de cookies publicitaires ni de traceurs de tiers. Elle enregistre sur votre téléphone uniquement ce qui est nécessaire : votre session de connexion, votre langue, votre devise, votre thème et le magasin choisi.' },
      { title: 'Vos choix', body: 'Vous pouvez ci-dessous accepter ou refuser les notifications de promotions et le partage de statistiques d’utilisation anonymes. Ces choix sont enregistrés sur votre compte et modifiables à tout moment.' },
    ],
  },
};

export const LEGAL_EN: Record<LegalDoc, LegalText> = {
  terms: {
    title: 'Terms of use', updated: 'Version 1.0 — 2 November 2026',
    sections: [
      { title: '1. Purpose', body: `These terms govern the use of the “Kin Marché Online” app, published for ${COMPANY}, to browse Kin Marché supermarkets, order, pay online and get deliveries.` },
      { title: '2. Account', body: 'Creating an account is free. You are responsible for your information and the secrecy of your password. Kin Marché may suspend an account used fraudulently.' },
      { title: '3. Orders', body: 'Each order is prepared by one Kin Marché supermarket. Totals (products, delivery fee, discounts) are computed by our servers and shown before you confirm. Products are reserved during the payment window.' },
      { title: '4. Payment', body: 'Cash on delivery is not accepted. Orders are paid in the app through licensed providers. An order is paid only once the provider confirms it or Kin Marché verifies your proof of payment. We never store card numbers or PINs.' },
      { title: '5. Delivery', body: 'Deliveries are made by drivers verified by Kin Marché. Give your delivery code to the driver only when you receive your parcel. Times shown are estimates computed from navigation data.' },
      { title: '6. Cancellations and refunds', body: 'Unpaid orders can be cancelled in the app. For paid orders, contact support. Missing, damaged or non-compliant items lead to a replacement or refund under Kin Marché policy.' },
      { title: '7. Reviews', body: 'Only customers who received an order can post a review. Reviews are moderated.' },
      { title: '8. Liability', body: 'Kin Marché strives to keep the app available but cannot guarantee uninterrupted service. Product photos are indicative.' },
      { title: '9. Governing law', body: 'These terms are governed by the law of the Democratic Republic of the Congo; courts of Kinshasa have jurisdiction.' },
      { title: '10. Contact', body: `Support: in-app messaging. Technical publisher: ${CONTACT}.` },
    ],
  },
  license: {
    title: 'End-user licence', updated: 'Version 1.0 — 2 November 2026',
    sections: [
      { title: '1. Licence', body: 'Kin Marché grants you a personal, free, non-exclusive, non-transferable licence to use the app for private purposes.' },
      { title: '2. Restrictions', body: 'You may not copy, modify, decompile, resell or distribute the app, bypass its security, or use it to collect other users’ data.' },
      { title: '3. Intellectual property', body: 'The Kin Marché name and logo, the slogan, texts, visuals and software remain the property of Kin Marché (Groupe BNB) and their authors. Development by MATULA DESIGN.' },
      { title: '4. Updates', body: 'Updates may be required to keep using the service.' },
      { title: '5. Termination', body: 'The licence ends when you delete your account or uninstall the app, or if you breach these terms.' },
    ],
  },
  privacy: {
    title: 'Privacy policy', updated: 'Version 1.0 — 2 November 2026',
    sections: [
      { title: '1. Controller', body: `${COMPANY}. Contact: in-app messaging or ${CONTACT}.` },
      { title: '2. Data collected', body: 'Identity and contact details, profile photo if you add one, delivery addresses and GPS position if you allow it, orders and payments (no card numbers or PINs), support messages, reviews, your phone’s notification token.' },
      { title: '3. Use', body: 'Fulfilling orders and deliveries, verifying payments, status updates, loyalty and coupons, support, fraud prevention, internal accounting and statistics. No data is sold.' },
      { title: '4. Sharing', body: 'The preparing supermarket and the assigned driver see only what they need during the order. The driver never sees your delivery code. Technical providers (Supabase hosting, Google maps, Expo notifications, payment providers) process data on our behalf.' },
      { title: '5. Location', body: 'Your location is used only when you allow it, to find a store that can deliver to you and save a precise address.' },
      { title: '6. Retention', body: 'Account data is kept while the account is active. When you delete it, personal data is erased; orders and accounting records are kept anonymously for the legal period.' },
      { title: '7. Security', body: 'Access is encrypted and partitioned: each customer sees only their own data, each store only its own.' },
      { title: '8. Your rights', body: 'You can view and edit your information, manage permissions and preferences, and delete your account at any time in the app.' },
    ],
  },
  cookies: {
    title: 'Cookie and tracker preferences', updated: 'Version 1.0 — 2 November 2026',
    sections: [
      { title: 'What the app stores', body: 'The mobile app uses no advertising cookies or third-party trackers. It stores only what is needed on your phone: your session, language, currency, theme and selected store.' },
      { title: 'Your choices', body: 'Below you can accept or refuse promotional notifications and anonymous usage statistics. Your choices are saved on your account.' },
    ],
  },
};
