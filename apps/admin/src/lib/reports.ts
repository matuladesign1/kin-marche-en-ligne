import type { SupabaseClient } from '@supabase/supabase-js';
import { PAY_FR, STATUS_FR, UNIT_FR } from './format';
import { TIER_FR } from './loyalty';

export interface ReportFilters {
  from: string;
  to: string;
  store?: string;
  province?: string;
  city?: string;
  commune?: string;
  quartier?: string;
  client?: string;
  status?: string;
  payment?: string;
}

export function readFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const get = (k: string) => {
    const v = sp[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s.replace(/[%,()]/g, '') : undefined;
  };
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: get('from') ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
    to: get('to') ?? today,
    store: get('store'), province: get('province'), city: get('city'), commune: get('commune'),
    quartier: get('quartier'), client: get('client'), status: get('status'), payment: get('payment'),
  };
}

export function filtersToQuery(f: ReportFilters): string {
  return new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
}

const ORDER_COLS = 'id, order_number, created_at, paid_at, status, payment_status, subtotal_usd, delivery_fee_usd, coupon_discount_usd, loyalty_discount_usd, total_usd, display_currency, delivery_address, customer_id, store_id, stores!inner(name, province, city, commune), profiles!orders_customer_id_fkey(full_name, email, phone)';

/** Commandes filtrées. La RLS limite déjà les lignes au périmètre de l'utilisateur (magasin ou plateforme). */
export async function fetchOrders(sb: SupabaseClient, f: ReportFilters, limit = 5000) {
  let q = sb.from('orders').select(ORDER_COLS)
    .gte('created_at', `${f.from}T00:00:00+01:00`).lte('created_at', `${f.to}T23:59:59+01:00`)
    .order('created_at', { ascending: false }).limit(limit);
  if (f.store) q = q.eq('store_id', f.store);
  if (f.province) q = q.ilike('stores.province', `%${f.province}%`);
  if (f.city) q = q.ilike('stores.city', `%${f.city}%`);
  if (f.commune) q = q.ilike('delivery_address->>commune', `%${f.commune}%`);
  if (f.quartier) q = q.ilike('delivery_address->>quartier', `%${f.quartier}%`);
  if (f.status) q = q.eq('status', f.status);
  if (f.payment) q = q.eq('payment_status', f.payment);
  if (f.client) {
    const { data: people } = await sb.from('profiles').select('id')
      .or(`email.ilike.%${f.client}%,full_name.ilike.%${f.client}%,phone.ilike.%${f.client}%`).limit(200);
    q = q.in('customer_id', (people ?? []).map((p) => p.id).concat(['00000000-0000-0000-0000-000000000000']));
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any[];
}

/** CSV compatible Excel (français) : BOM UTF-8 et séparateur point-virgule. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
}

export function csvResponse(name: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

const d = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }) : '');

export async function buildExport(sb: SupabaseClient, type: string, f: ReportFilters, scope: 'admin' | 'store'): Promise<{ name: string; csv: string } | null> {
  const stamp = `${f.from}_${f.to}`;
  switch (type) {
    case 'commandes': {
      const rows = await fetchOrders(sb, f);
      return {
        name: `commandes_${stamp}`,
        csv: toCsv(
          ['N° commande', 'Date', 'Payée le', 'Magasin', 'Province', 'Ville', 'Client', 'E-mail', 'Téléphone', 'Commune livraison', 'Quartier', 'Statut', 'Paiement', 'Sous-total USD', 'Livraison USD', 'Réduction coupon USD', 'Réduction fidélité USD', 'Total USD', 'Devise affichée'],
          rows.map((o) => [o.order_number, d(o.created_at), d(o.paid_at), o.stores?.name, o.stores?.province, o.stores?.city,
            o.profiles?.full_name, o.profiles?.email, o.profiles?.phone, o.delivery_address?.commune, o.delivery_address?.quartier,
            STATUS_FR[o.status], PAY_FR[o.payment_status], Number(o.subtotal_usd), Number(o.delivery_fee_usd),
            Number(o.coupon_discount_usd), Number(o.loyalty_discount_usd), Number(o.total_usd), o.display_currency]),
        ),
      };
    }
    case 'articles': {
      const orders = await fetchOrders(sb, f);
      const ids = orders.map((o) => o.id);
      const items: any[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await sb.from('order_items').select('order_id, product_name, unit, unit_price_usd, quantity, line_total_usd, products(sku, barcode, brand)').in('order_id', ids.slice(i, i + 300));
        items.push(...(data ?? []));
      }
      const byId = new Map(orders.map((o) => [o.id, o]));
      return {
        name: `articles_vendus_${stamp}`,
        csv: toCsv(['N° commande', 'Date', 'Magasin', 'Statut', 'Paiement', 'SKU', 'Code-barres', 'Marque', 'Produit', 'Unité', 'Prix unitaire USD', 'Quantité', 'Total ligne USD'],
          items.map((i) => {
            const o = byId.get(i.order_id);
            return [o?.order_number, d(o?.created_at), o?.stores?.name, STATUS_FR[o?.status], PAY_FR[o?.payment_status], i.products?.sku, i.products?.barcode, i.products?.brand,
              i.product_name, UNIT_FR[i.unit], Number(i.unit_price_usd), Number(i.quantity), Number(i.line_total_usd)];
          })),
      };
    }
    case 'paiements': {
      let q = sb.from('payments').select('created_at, confirmed_at, method, provider, provider_reference, amount, currency, amount_usd, status, failure_reason, orders!inner(order_number, store_id, stores(name))')
        .gte('created_at', `${f.from}T00:00:00+01:00`).lte('created_at', `${f.to}T23:59:59+01:00`).order('created_at', { ascending: false }).limit(10000);
      if (f.store) q = q.eq('orders.store_id', f.store);
      if (f.payment) q = q.eq('status', f.payment);
      const { data } = await q;
      return {
        name: `paiements_${stamp}`,
        csv: toCsv(['Date', 'Confirmé le', 'Commande', 'Magasin', 'Moyen', 'Prestataire', 'Référence', 'Montant', 'Devise', 'Montant USD', 'Statut', 'Motif d’échec'],
          (data ?? []).map((p: any) => [d(p.created_at), d(p.confirmed_at), p.orders?.order_number, p.orders?.stores?.name, p.method, p.provider, p.provider_reference,
            Number(p.amount), p.currency, Number(p.amount_usd), PAY_FR[p.status], p.failure_reason])),
      };
    }
    case 'journal': {
      let q = sb.from('financial_ledger').select('created_at, entry_type, amount_usd, description, reference, stores(name), orders(order_number)')
        .gte('created_at', `${f.from}T00:00:00+01:00`).lte('created_at', `${f.to}T23:59:59+01:00`).order('created_at', { ascending: false }).limit(20000);
      if (f.store) q = q.eq('store_id', f.store);
      const { data } = await q;
      return {
        name: `journal_financier_${stamp}`,
        csv: toCsv(['Date', 'Type', 'Montant USD', 'Magasin', 'Commande', 'Description', 'Référence'],
          (data ?? []).map((r: any) => [d(r.created_at), r.entry_type, Number(r.amount_usd), r.stores?.name, r.orders?.order_number, r.description, r.reference])),
      };
    }
    case 'stock': {
      let q = sb.from('store_inventory').select('price_usd, promo_price_usd, promo_ends_at, stock, low_stock_threshold, is_available, sold_count, expiry_date, updated_at, stores(name), products(sku, barcode, name, brand, unit, product_categories(name))').order('updated_at', { ascending: false }).limit(20000);
      if (f.store) q = q.eq('store_id', f.store);
      const { data } = await q;
      return {
        name: `produits_stock_${new Date().toISOString().slice(0, 10)}`,
        csv: toCsv(['Magasin', 'SKU', 'Code-barres', 'Produit', 'Marque', 'Catégorie', 'Unité', 'Prix USD', 'Prix promo USD', 'Fin promo', 'Stock', 'Seuil alerte', 'En vente', 'Vendus', 'Expiration lot', 'Mis à jour'],
          (data ?? []).map((r: any) => [r.stores?.name, r.products?.sku, r.products?.barcode, r.products?.name, r.products?.brand, r.products?.product_categories?.name?.fr,
            UNIT_FR[r.products?.unit], Number(r.price_usd), r.promo_price_usd != null ? Number(r.promo_price_usd) : null, d(r.promo_ends_at), Number(r.stock),
            Number(r.low_stock_threshold), r.is_available ? 'oui' : 'non', r.sold_count, r.expiry_date, d(r.updated_at)])),
      };
    }
    case 'clients': {
      if (scope !== 'admin') return null;
      const { data } = await sb.from('profiles').select('full_name, email, phone, language, currency, created_at, is_active, loyalty_accounts(points_balance, lifetime_points, tier)')
        .eq('role', 'customer').order('created_at', { ascending: false }).limit(50000);
      return {
        name: `clients_${new Date().toISOString().slice(0, 10)}`,
        csv: toCsv(['Nom', 'E-mail', 'Téléphone', 'Langue', 'Devise', 'Inscrit le', 'Actif', 'Points', 'Points cumulés', 'Carte fidélité'],
          (data ?? []).map((c: any) => [c.full_name, c.email, c.phone, c.language, c.currency, d(c.created_at), c.is_active ? 'oui' : 'non',
            c.loyalty_accounts?.points_balance, c.loyalty_accounts?.lifetime_points, TIER_FR[c.loyalty_accounts?.tier] ?? c.loyalty_accounts?.tier])),
      };
    }
    case 'livreurs': {
      if (scope !== 'admin') return null;
      const { data } = await sb.from('drivers').select('driver_code, status, zone_communes, is_available, verified_at, rating, rating_count, created_at, profiles(full_name, email, phone), driver_vehicles(mode, plate_number), driver_wallets(balance_usd)').order('created_at');
      return {
        name: `livreurs_${new Date().toISOString().slice(0, 10)}`,
        csv: toCsv(['Code', 'Nom', 'E-mail', 'Téléphone', 'Statut', 'Zones', 'Transport', 'Immatriculation', 'Disponible', 'Validé le', 'Note', 'Avis', 'Solde USD', 'Inscrit le'],
          (data ?? []).map((r: any) => [r.driver_code, r.profiles?.full_name, r.profiles?.email, r.profiles?.phone, r.status, (r.zone_communes ?? []).join(', '),
            r.driver_vehicles?.[0]?.mode, r.driver_vehicles?.[0]?.plate_number, r.is_available ? 'oui' : 'non', d(r.verified_at), Number(r.rating), r.rating_count,
            r.driver_wallets?.balance_usd != null ? Number(r.driver_wallets.balance_usd) : 0, d(r.created_at)])),
      };
    }
    case 'magasins': {
      if (scope !== 'admin') return null;
      const { data } = await sb.from('stores').select('code, name, province, city, commune, quartier, avenue, street_number, landmark, latitude, longitude, address_verified, phone, manager_name, is_open, is_active, delivery_radius_km, delivery_fee_usd, rating').order('name');
      return {
        name: 'magasins',
        csv: toCsv(['code', 'nom', 'province', 'ville', 'commune', 'quartier', 'avenue', 'numero', 'reference', 'latitude', 'longitude', 'adresse_verifiee', 'telephone', 'directeur', 'ouvert', 'actif', 'rayon_livraison_km', 'frais_livraison_usd', 'note'],
          (data ?? []).map((s) => [s.code, s.name, s.province, s.city, s.commune, s.quartier, s.avenue, s.street_number, s.landmark, s.latitude, s.longitude,
            s.address_verified ? 'oui' : 'non', s.phone, s.manager_name, s.is_open ? 'oui' : 'non', s.is_active ? 'oui' : 'non', Number(s.delivery_radius_km), Number(s.delivery_fee_usd), Number(s.rating)])),
      };
    }
    default:
      return null;
  }
}
