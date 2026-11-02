# Kin Marché en ligne

Supermarché en ligne en RDC — **« Au prix du Grand Marché »**
Kin Marché · Groupe BNB · Kinshasa · Développement : **MATULA DESIGN** (+243 849 009 239 · omalbac@gmail.com)

Application de commerce électronique pour les clients des supermarchés Kin Marché (succursales officielles, pas une marketplace).

## État du projet

| Étape | Contenu | État |
|---|---|---|
| 1 | Base de données Supabase complète (≈ 50 tables, RLS, logique métier serveur) | ✅ installée |
| 1 | Application mobile Expo — espace client | ✅ code livré |
| 1 | Paiement : architecture serveur + Edge Function `payments-initiate` | ✅ déployée, **en attente d'un prestataire agréé** |
| 2 | Administration web (Next.js) : admin de supermarché + admin général | ✅ code livré (`apps/admin`) |
| 2 | APK Android de test | ✅ généré automatiquement par GitHub (onglet Releases) |
| 3 | Espace livreur (mobile) : candidature, missions, scan colis, OTP, revenus, carte QR | ✅ |
| 4 | Admin général : livreurs, finances et budgets, coupons, bannières, partenaires, catégories | ✅ |
| 5 | Paiement réel, carte interactive, recherche photo/voix, envoi des notifications push, exports | à faire |

## Structure

```
apps/mobile/              Application Expo (Android, iOS, web) — TypeScript, expo-router
apps/admin/               Administration web Next.js (admin général + admin de supermarché)
supabase/migrations/      Schéma SQL versionné (à appliquer dans l'ordre)
supabase/manual/          2 fonctions à coller dans le SQL Editor (voir plus bas)
supabase/functions/       Edge Functions (paiements)
docs/                     Modèle CSV d'import des magasins
```

## Base de données (projet Supabase « Kin Marché en ligne »)

Points clés de sécurité :

- **RLS sur toutes les tables.** Un client ne voit que ses commandes, un directeur que son magasin, un livreur que ses missions acceptées.
- **Rôle attribué côté serveur uniquement.** Toute inscription crée un compte `customer` ; un utilisateur ne peut jamais modifier son propre rôle (trigger + audit).
- **Commandes et prix calculés côté serveur** (`quote_order`, `place_order`) : le client ne peut pas envoyer un prix ou un total.
- **Paiement confirmé uniquement par le serveur** (`confirm_payment`, exécutable par le rôle service seulement, appelé par le webhook vérifié du prestataire). Pas de paiement à la livraison.
- **Stock réservé** à la commande, libéré si annulation ou délai de paiement dépassé (`expire_unpaid_orders`).
- **OTP de livraison** visible uniquement par le client ; le livreur le saisit (5 essais max). **Code colis** scanné au magasin avant le départ.
- **Fidélité** créditée seulement après livraison confirmée ; points restitués en cas d'annulation.
- Journal d'audit, journal financier, historique horodaté des 16 étapes de livraison, notifications en temps réel.

Fonctions RPC principales : `search_catalog`, `recommend_stores` (recommande le magasin qui **peut** servir la commande), `add_to_cart`, `set_cart_quantity`, `quote_order`, `place_order`, `cancel_order`, `get_order_tracking`, `advance_order_status`, `assign_next_driver`, `respond_to_offer`, `confirm_pickup`, `verify_delivery_otp`, `update_driver_location`.

Le parcours complet (devis → paiement serveur → préparation → affectation automatique du livreur → scan du colis → OTP → fidélité et portefeuille livreur) a été testé de bout en bout dans une transaction annulée.

### ⚠️ À faire une fois : 2 fonctions à installer à la main

`add_to_cart` et `place_order` vident le panier du client ; Supabase demande une confirmation que l'outil d'installation automatique ne pouvait pas afficher.
Ouvrir Supabase → projet **Kin Marché en ligne** → **SQL Editor** → coller `supabase/manual/install_cart_and_order_functions.sql` → **Run**.

### Tâches planifiées (pg_cron)

Dans le SQL Editor, après avoir activé l'extension `pg_cron` :

```sql
select cron.schedule('km-expire-unpaid', '*/5 * * * *', 'select public.expire_unpaid_orders()');
select cron.schedule('km-expire-offers', '* * * * *',   'select public.expire_stale_offers()');
```

### Créer le premier administrateur général

Créer le compte depuis l'application, puis dans le SQL Editor :

```sql
update public.profiles set role = 'super_admin' where email = 'adresse@exemple.com';
```

Même principe pour un directeur (`store_admin` + ligne dans `store_managers`) ou un livreur (`driver` + ligne dans `drivers`), en attendant les écrans d'administration.

## Magasins : aucune adresse inventée

Aucun magasin n'a été créé : nous n'avons pas trouvé de liste officielle vérifiée (adresses + GPS). Des articles de presse mentionnent des points de vente (Ngaliema/GB, Lingwala, Matete, Mont-Ngafula, Matadi Kibala, Pompage…), mais sans adresses complètes. Compléter `docs/modele_import_magasins.csv` avec les données officielles de Kin Marché ; une adresse incomplète s'affiche « Adresse à vérifier » (`address_verified = false`).

## Paiements

Méthodes prévues : M-Pesa, Orange Money, Airtel Money, Afrimoney, Visa, Mastercard, virement bancaire.
L'Edge Function `payments-initiate` répond `PAYMENT_PROVIDER_NOT_CONFIGURED` tant qu'aucun prestataire agréé n'est branché : **aucun paiement n'est simulé**. Pour activer :

1. Choisir le prestataire (agrégateur Mobile Money RDC / passerelle carte) et obtenir les identifiants.
2. Écrire son adaptateur dans `supabase/functions/_shared/payment-provider.ts` (`initiate` + `parseWebhook` avec vérification de signature).
3. Ajouter les secrets (`PAYMENT_PROVIDER`, clés) dans Supabase → Edge Functions → Secrets — **jamais dans le code**.
4. Déployer `payments-webhook` (avec `verify_jwt = false`) et redéployer `payments-initiate`.
5. Renseigner `app_settings.payments.enabled_methods`.

## Application mobile

```bash
cd apps/mobile
cp .env.example .env          # URL + clé publique (déjà renseignées)
npm install
npx expo install --fix        # aligne les versions sur le SDK Expo
npx tsc --noEmit
npx expo start
```

Écrans client : accueil (recherche, magasin, bannières, accès rapides, catégories, offres, recommandés, plus vendus, nouveautés, produits locaux, partenaires), catégories, fiche produit (galerie, stock par magasin, autres magasins, avis vérifiés, favoris), recherche texte + **scan de code-barres** + alternatives, magasins (position GPS, zone de livraison, frais, itinéraire), panier mono-magasin, adresses avec GPS, validation (coupon, points, frais calculés côté serveur), paiement, commandes et suivi temps réel (16 étapes, livreur, OTP), fidélité, coupons, notifications, assistance (tickets + messagerie), gâteaux personnalisés, paramètres (langue, devise, thème clair/sombre).

Rôles : après connexion, chaque compte est redirigé vers son espace (`/store-admin`, `/driver`, `/admin`) ; ces espaces affichent pour l'instant un écran « en construction ».

Langues : français et anglais complets ; **swahili et lingala partiels, à faire valider par des locuteurs natifs** (les textes manquants s'affichent en français).

Logo : `assets/images/logo-wide.png` (thème) et `assets/images/icon.png` (icône), non modifiés. L'administrateur peut remplacer le logo et les couleurs via `app_settings.branding` sans toucher au code.

Notifications push : exécuter `eas init` pour obtenir le `projectId`, puis l'envoi serveur sera ajouté avec l'espace admin. Les notifications internes fonctionnent déjà en temps réel.

## Administration web (`apps/admin`)

```bash
cd apps/admin
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

Mise en ligne : importer le dépôt sur Vercel, « Root Directory » = `apps/admin`, ajouter les deux variables `NEXT_PUBLIC_…` de `.env.example`.

- **Administrateur général** (`/admin`) : tableau de bord, supermarchés (saisie, import CSV, correction GPS, historique, activation), gestionnaires par magasin, rôles des comptes, taux CDF/EUR avec historique, logo et couleurs.
- **Admin de supermarché** (`/magasin`) : chiffre d'affaires payé (24 h / 7 j / 30 j), commandes par statut, alertes de stock, meilleures ventes ; file des commandes avec validation étape par étape (préparation → vérifiés → emballés → prête, qui déclenche l'appel automatique d'un livreur), code colis, signalement de produits manquants ; produits, prix, promotions datées, stock, photos et vidéos.

Chaque espace n'est accessible qu'au bon rôle, et la RLS empêche un directeur de voir un autre magasin même en modifiant l'URL.

## APK Android de test

À chaque modification de l'application mobile, GitHub compile un APK et le publie dans **Releases** du dépôt. Il est signé avec la clé de débogage : il sert aux tests (installation directe sur un téléphone Android), pas à la publication sur le Play Store, qui demandera une clé de signature dédiée (EAS ou keystore privé).

## Pas encore inclus (prochaines étapes)

- Recherche par photo, vidéo et voix (nécessite un vrai service de reconnaissance — non simulé).
- Carte interactive (Google Maps / Mapbox, clé API requise) et calcul de temps de trajet par un service de navigation.
- Espaces magasin, livreur et administrateur ; import CSV des magasins ; module finances/budgets (tables prêtes).
