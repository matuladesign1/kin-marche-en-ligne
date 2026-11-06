import { Image } from 'expo-image';
import { supabase } from './supabase';
import type { CatalogItem } from './types';

// Recherche par photo similaire, calculée sur le téléphone, sans service extérieur.
// Chaque photo est résumée par une empreinte Blurhash 4 × 4 (couleur moyenne et répartition des couleurs),
// produite par expo-image (même calcul que l'administration à l'envoi des photos).
// Les produits sont classés du plus ressemblant au moins ressemblant.

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const COMPONENTS: [number, number] = [4, 4];
/** Photos réduites à 96 px avant le calcul : rapide, et identique pour le client et le catalogue. */
const SIZE = 96;
/** Anciennes photos sans empreinte calculées par recherche (téléchargement limité sur données mobiles). */
const MAX_BACKFILL = 12;

function decode83(s: string): number {
  let v = 0;
  for (const c of s) {
    const d = B83.indexOf(c);
    if (d < 0) return NaN;
    v = v * 83 + d;
  }
  return v;
}

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const signPow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

/** Couleur (RGB linéaire) → CIELAB, pour comparer les couleurs comme l'œil. */
function toLab(r: number, g: number, b: number): [number, number, number] {
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export interface VisualFeature {
  lab: [number, number, number];
  /** 15 composantes de répartition × 3 canaux. */
  ac: number[];
}

/** Lit une empreinte Blurhash 4 × 4 (36 caractères). */
export function blurhashFeature(hash: string | null | undefined): VisualFeature | null {
  if (!hash || hash.length !== 36) return null;
  const size = decode83(hash[0]);
  if ((size % 9) + 1 !== 4 || Math.floor(size / 9) + 1 !== 4) return null;
  const maxValue = (decode83(hash[1]) + 1) / 166;
  const dc = decode83(hash.slice(2, 6));
  if (!Number.isFinite(dc) || !Number.isFinite(maxValue)) return null;
  const lab = toLab(toLinear(dc >> 16), toLinear((dc >> 8) & 255), toLinear(dc & 255));
  const ac: number[] = [];
  for (let i = 1; i < 16; i++) {
    const v = decode83(hash.slice(4 + i * 2, 6 + i * 2));
    if (!Number.isFinite(v)) return null;
    for (const q of [Math.floor(v / 361), Math.floor(v / 19) % 19, v % 19]) ac.push(signPow((q - 9) / 9, 2) * maxValue);
  }
  return { lab, ac };
}

/** Écart entre deux photos (0 = identiques). La teinte compte plus que la luminosité, qui dépend de l'éclairage. */
export function visualDistance(a: VisualFeature, b: VisualFeature): number {
  const dl = a.lab[0] - b.lab[0], da = a.lab[1] - b.lab[1], db = a.lab[2] - b.lab[2];
  const color = Math.sqrt(0.5 * dl * dl + da * da + db * db) / 100;
  let layout = 0;
  for (let i = 1; i < 16; i++) {
    const order = (i % 4) + Math.floor(i / 4);   // basses fréquences = grandes formes du produit
    const w = order === 1 ? 1 : order === 2 ? 0.5 : order === 3 ? 0.2 : 0.1;
    for (let c = 0; c < 3; c++) {
      const d = a.ac[(i - 1) * 3 + c] - b.ac[(i - 1) * 3 + c];
      layout += w * d * d;
    }
  }
  return color + 0.8 * Math.sqrt(layout);
}

/** Ressemblance affichable (100 % = même photo). */
export function similarityPercent(distance: number): number {
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-1.6 * distance))));
}

/** Empreinte d'une photo (fichier du téléphone ou adresse web). */
export async function photoBlurhash(uri: string): Promise<string | null> {
  const ref = await Image.loadAsync(uri, { maxWidth: SIZE, maxHeight: SIZE });
  try {
    return await Image.generateBlurhashAsync(ref, COMPONENTS);
  } finally {
    try { ref.release(); } catch { /* déjà libérée */ }
  }
}

interface VisualRow { image_id: string; product_id: string; url: string; blurhash: string | null }

export interface SimilarResult {
  items: CatalogItem[];
  /** Ressemblance (%) par produit. */
  score: Record<string, number>;
}

/** Produits du catalogue les plus ressemblants à la photo (une offre par produit, en stock et moins chère d'abord). */
export async function findSimilarProducts(photoHash: string, opts: { storeId: string | null; signedIn: boolean; limit?: number }): Promise<SimilarResult> {
  const query = blurhashFeature(photoHash);
  if (!query) throw new Error('NO_FEATURE');
  const { data, error } = await supabase.rpc('visual_catalog');
  if (error) throw error;
  const rows = (data ?? []) as VisualRow[];

  // Anciennes photos sans empreinte : calculées ici une seule fois, puis enregistrées pour tout le monde.
  const missing = rows.filter((r) => !r.blurhash).slice(0, MAX_BACKFILL);
  for (let k = 0; k < missing.length; k += 3) {
    await Promise.all(missing.slice(k, k + 3).map(async (r) => {
      try {
        const h = await photoBlurhash(r.url);
        if (!h) return;
        r.blurhash = h;
        if (opts.signedIn) supabase.rpc('set_image_blurhash', { p_image: r.image_id, p_hash: h }).then(() => undefined);
      } catch { /* photo illisible : ignorée */ }
    }));
  }

  const best = new Map<string, number>();
  for (const r of rows) {
    const f = blurhashFeature(r.blurhash);
    if (!f) continue;
    const d = visualDistance(query, f);
    const cur = best.get(r.product_id);
    if (cur === undefined || d < cur) best.set(r.product_id, d);
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, opts.limit ?? 30);
  if (!ranked.length) return { items: [], score: {} };

  let q = supabase.from('catalog_items').select('*').in('product_id', ranked.map(([id]) => id));
  if (opts.storeId) q = q.eq('store_id', opts.storeId);
  const { data: offers, error: e2 } = await q;
  if (e2) throw e2;
  const byProduct = new Map<string, CatalogItem>();
  for (const it of (offers ?? []) as CatalogItem[]) {
    const cur = byProduct.get(it.product_id);
    if (!cur || (it.in_stock && !cur.in_stock) || (it.in_stock === cur.in_stock && it.effective_price_usd < cur.effective_price_usd)) {
      byProduct.set(it.product_id, it);
    }
  }
  const score: Record<string, number> = {};
  const items: CatalogItem[] = [];
  for (const [id, d] of ranked) {
    const it = byProduct.get(id);
    if (!it) continue;
    score[id] = similarityPercent(d);
    items.push(it);
  }
  return { items, score };
}
