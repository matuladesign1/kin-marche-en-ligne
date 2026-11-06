import { Image } from 'expo-image';
import { supabase } from './supabase';
import type { CatalogItem } from './types';

// Recherche par photo : on ne montre que les articles qui ressemblent vraiment à la photo.
// Chaque photo est résumée par une empreinte Blurhash 9 × 9 (calculée par expo-image sur le téléphone,
// et par le navigateur à l'envoi des photos dans l'administration). L'empreinte est redessinée en
// petite image 16 × 16 ; le fond (couleur du bord de la photo) est écarté, puis on compare :
//  - les couleurs du produit (palette) ;
//  - le produit lui-même, recadré et redessiné en 8 × 8 (même taille quel que soit le cadrage).
// On ne garde que l'article le plus proche s'il ressemble nettement (et ceux presque aussi proches),
// avec les articles ressemblants de sa catégorie. Sinon : aucun résultat plutôt que des articles sans rapport.

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
/** Empreinte 9 × 9 (le maximum de Blurhash) : 166 caractères, commence par « | ». */
export const COMPONENTS: [number, number] = [9, 9];
/** Photos réduites à 96 px avant le calcul : rapide, et identique pour le client et le catalogue. */
const SIZE = 96;
/** Anciennes photos sans empreinte calculées par recherche (téléchargement limité sur données mobiles). */
const MAX_BACKFILL = 12;
/** Ressemblance (0 à 1) à partir de laquelle l'article est retenu d'office. */
const SURE = 0.5;
/** En dessous de SURE : retenu seulement s'il dépasse ce seuil et nettement le 2e article. */
const MIN_MATCH = 0.3;
const LEAD = 0.1;
/** Articles presque aussi proches que le meilleur : gardés aussi. */
const MARGIN = 0.04;
/** Articles de la même catégorie montrés en plus s'ils ressemblent au moins à ce point. */
const MIN_RELATED = 0.42;
const MAX_RESULTS = 12;

const GRID = 16;
const HUES = 12;
const LEVELS = 3;
const GREYS = 5;
const BINS = HUES * LEVELS + GREYS;

/** Poids de chaque point de l'image : le produit est au centre de la photo (recadrage carré). */
const WEIGHT = (() => {
  const w = new Float32Array(GRID * GRID);
  const c = (GRID - 1) / 2;
  const s = GRID * 0.3;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    w[y * GRID + x] = Math.exp(-((x - c) ** 2 + (y - c) ** 2) / (2 * s * s));
  }
  return w;
})();

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
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
  /** Palette du produit : 12 teintes × 3 luminosités + 5 gris, somme = 1. */
  hist: Float32Array;
  /** Le produit seul (cadre ajusté au produit), redessiné en 6 × 6, en CIELAB. */
  obj: Float32Array;
}

const OBJ = 8;
const deltaE = (lab: Float32Array, i: number, L: number, a: number, b: number) =>
  Math.sqrt((lab[i] - L) ** 2 + (lab[i + 1] - a) ** 2 + (lab[i + 2] - b) ** 2);

/** Sépare le produit du fond : le fond est la couleur du bord de la photo (blanc du catalogue, table, mur…). */
function foreground(lab: Float32Array): Float32Array {
  const border: number[] = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    if (x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1) border.push((y * GRID + x) * 3);
  }
  const median = (k: number) => {
    const v = border.map((i) => lab[i + k]).sort((m, n) => m - n);
    return v[v.length >> 1];
  };
  const bL = median(0), bA = median(1), bB = median(2);
  const fg = new Float32Array(GRID * GRID);
  let share = 0;
  for (let p = 0; p < GRID * GRID; p++) {
    fg[p] = clamp01((deltaE(lab, p * 3, bL, bA, bB) - 6) / 10);
    share += fg[p];
  }
  // Produit qui remplit toute la photo (ou photo unie) : pas de fond à retirer.
  if (share < GRID * GRID * 0.12) fg.fill(1);
  return fg;
}

function palette(lab: Float32Array, fg: Float32Array): Float32Array {
  const h = new Float32Array(BINS);
  for (let p = 0; p < GRID * GRID; p++) {
    const L = lab[p * 3], a = lab[p * 3 + 1], b = lab[p * 3 + 2];
    const chroma = Math.hypot(a, b);
    const w = fg[p] * (0.5 + 0.5 * WEIGHT[p]);
    if (w <= 0) continue;
    const colored = clamp01((chroma - 6) / 14);   // 0 = gris, 1 = coloré
    if (colored < 1) {                            // gris : 5 niveaux de luminosité
      const pos = clamp01(L / 100) * (GREYS - 1);
      const g0 = Math.floor(pos), f = pos - g0;
      h[HUES * LEVELS + g0] += w * (1 - colored) * (1 - f);
      if (g0 + 1 < GREYS) h[HUES * LEVELS + g0 + 1] += w * (1 - colored) * f;
    }
    if (colored > 0) {                            // couleurs : teinte × luminosité, réparties en douceur
      const hue = ((((Math.atan2(b, a) / (2 * Math.PI)) % 1) + 1) % 1) * HUES;
      const h0 = Math.floor(hue) % HUES, h1 = (h0 + 1) % HUES, fh = hue - Math.floor(hue);
      const lv = clamp01(L / 100) * (LEVELS - 1);
      const l0 = Math.min(LEVELS - 1, Math.floor(lv)), l1 = Math.min(LEVELS - 1, l0 + 1), fl = lv - l0;
      const add = (hh: number, ll: number, v: number) => { h[ll * HUES + hh] += w * colored * v; };
      add(h0, l0, (1 - fh) * (1 - fl)); add(h1, l0, fh * (1 - fl));
      add(h0, l1, (1 - fh) * fl); add(h1, l1, fh * fl);
    }
  }
  let sum = 0;
  for (let i = 0; i < BINS; i++) sum += h[i];
  if (sum > 0) for (let i = 0; i < BINS; i++) h[i] /= sum;
  return h;
}

/** Le produit recadré (boîte englobante) et redessiné en 6 × 6 : même taille quel que soit le cadrage. */
function objectGrid(lab: Float32Array, fg: Float32Array): Float32Array {
  let x0 = GRID, x1 = -1, y0 = GRID, y1 = -1;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    if (fg[y * GRID + x] >= 0.5) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = GRID - 1; y1 = GRID - 1; }
  const out = new Float32Array(OBJ * OBJ * 3);
  for (let j = 0; j < OBJ; j++) {
    for (let i = 0; i < OBJ; i++) {
      const fx = x0 + ((i + 0.5) / OBJ) * (x1 - x0 + 1) - 0.5;
      const fy = y0 + ((j + 0.5) / OBJ) * (y1 - y0 + 1) - 0.5;
      const xa = Math.max(0, Math.min(GRID - 1, Math.floor(fx))), xb = Math.min(GRID - 1, xa + 1), tx = clamp01(fx - xa);
      const ya = Math.max(0, Math.min(GRID - 1, Math.floor(fy))), yb = Math.min(GRID - 1, ya + 1), ty = clamp01(fy - ya);
      for (let k = 0; k < 3; k++) {
        const v = (lab[(ya * GRID + xa) * 3 + k] * (1 - tx) + lab[(ya * GRID + xb) * 3 + k] * tx) * (1 - ty)
          + (lab[(yb * GRID + xa) * 3 + k] * (1 - tx) + lab[(yb * GRID + xb) * 3 + k] * tx) * ty;
        out[(j * OBJ + i) * 3 + k] = v;
      }
    }
  }
  return out;
}

/** Lit une empreinte Blurhash (4 × 4 au moins) : palette du produit et produit redessiné. */
export function blurhashFeature(hash: string | null | undefined): VisualFeature | null {
  if (!hash || hash.length < 6) return null;
  const size = decode83(hash[0]);
  if (!Number.isFinite(size)) return null;
  const nx = (size % 9) + 1, ny = Math.floor(size / 9) + 1;
  if (nx * ny < 16 || hash.length !== 4 + 2 * nx * ny) return null;
  const maxValue = (decode83(hash[1]) + 1) / 166;
  const dc = decode83(hash.slice(2, 6));
  if (!Number.isFinite(dc) || !Number.isFinite(maxValue)) return null;
  const comps: number[] = [toLinear(dc >> 16), toLinear((dc >> 8) & 255), toLinear(dc & 255)];
  for (let i = 1; i < nx * ny; i++) {
    const v = decode83(hash.slice(4 + i * 2, 6 + i * 2));
    if (!Number.isFinite(v)) return null;
    for (const q of [Math.floor(v / 361), Math.floor(v / 19) % 19, v % 19]) comps.push(signPow((q - 9) / 9, 2) * maxValue);
  }
  // Image 12 × 12 redessinée à partir de l'empreinte (décodage Blurhash), en CIELAB.
  const lab = new Float32Array(GRID * GRID * 3);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < ny; j++) {
        const cy = Math.cos((Math.PI * y * j) / GRID);
        for (let i = 0; i < nx; i++) {
          const basis = Math.cos((Math.PI * x * i) / GRID) * cy;
          const k = (i + j * nx) * 3;
          r += comps[k] * basis; g += comps[k + 1] * basis; b += comps[k + 2] * basis;
        }
      }
      lab.set(toLab(clamp01(r), clamp01(g), clamp01(b)), (y * GRID + x) * 3);
    }
  }
  const fg = foreground(lab);
  return { hist: palette(lab, fg), obj: objectGrid(lab, fg) };
}

/** Ressemblance de deux photos, de 0 (rien à voir) à 1 (identiques). */
export function visualSimilarity(a: VisualFeature, b: VisualFeature): number {
  let common = 0;
  for (let i = 0; i < BINS; i++) common += Math.min(a.hist[i], b.hist[i]);
  let sum = 0;
  for (let p = 0; p < OBJ * OBJ; p++) {
    const dl = (a.obj[p * 3] - b.obj[p * 3]) * 0.6;   // la luminosité dépend de l'éclairage : elle compte moins
    const da = a.obj[p * 3 + 1] - b.obj[p * 3 + 1];
    const db = a.obj[p * 3 + 2] - b.obj[p * 3 + 2];
    sum += Math.sqrt(dl * dl + da * da + db * db);
  }
  const layout = clamp01(1 - sum / (OBJ * OBJ) / 40);
  return 0.65 * common + 0.35 * layout;
}

/** Empreintes du catalogue déjà lues (évite de les redessiner à chaque recherche). */
const featureCache = new Map<string, VisualFeature | null>();
function cachedFeature(hash: string | null): VisualFeature | null {
  if (!hash) return null;
  let f = featureCache.get(hash);
  if (f === undefined) {
    f = blurhashFeature(hash);
    if (featureCache.size > 4000) featureCache.clear();
    featureCache.set(hash, f);
  }
  return f;
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

export interface Ranked { productId: string; score: number }

/**
 * Choisit les articles à montrer : le meilleur s'il ressemble assez, ceux presque aussi proches,
 * puis les articles ressemblants de la même catégorie. Rien si aucun article ne ressemble.
 */
export function pickSimilar(ranked: Ranked[], categoryOf: (productId: string) => string | null): Ranked[] {
  const best = ranked[0];
  if (!best) return [];
  const second = ranked[1]?.score ?? 0;
  if (best.score < SURE && !(best.score >= MIN_MATCH && best.score - second >= LEAD)) return [];
  const keep = ranked.filter((r) => r.score >= best.score - MARGIN);
  const ids = new Set(keep.map((r) => r.productId));
  const cats = new Set(keep.map((r) => categoryOf(r.productId)).filter(Boolean));
  for (const r of ranked) {
    if (keep.length >= MAX_RESULTS) break;
    if (!ids.has(r.productId) && r.score >= MIN_RELATED && cats.has(categoryOf(r.productId))) {
      keep.push(r);
      ids.add(r.productId);
    }
  }
  return keep;
}

/** Articles du catalogue qui ressemblent à la photo (une offre par article, en stock et moins chère d'abord). */
export async function findSimilarProducts(photoHash: string, opts: { storeId: string | null }): Promise<CatalogItem[]> {
  const query = blurhashFeature(photoHash);
  if (!query) throw new Error('NO_FEATURE');
  const { data, error } = await supabase.rpc('visual_catalog');
  if (error) throw error;
  const rows = (data ?? []) as VisualRow[];

  // Photos sans empreinte 6 × 6 : calculées ici une seule fois, puis enregistrées pour tout le monde.
  const missing = rows.filter((r) => !r.blurhash || r.blurhash[0] !== '|').slice(0, MAX_BACKFILL);
  for (let k = 0; k < missing.length; k += 3) {
    await Promise.all(missing.slice(k, k + 3).map(async (r) => {
      try {
        const h = await photoBlurhash(r.url);
        if (!h) return;
        r.blurhash = h;
        supabase.rpc('set_image_blurhash', { p_image: r.image_id, p_hash: h }).then(() => undefined);
      } catch { /* photo illisible : ignorée */ }
    }));
  }

  const best = new Map<string, number>();
  for (const r of rows) {
    const f = cachedFeature(r.blurhash);
    if (!f) continue;
    const s = visualSimilarity(query, f);
    if (s > (best.get(r.product_id) ?? -1)) best.set(r.product_id, s);
  }
  const ranked = [...best.entries()].map(([productId, score]) => ({ productId, score })).sort((a, b) => b.score - a.score).slice(0, 40);
  if (!ranked.length || ranked[0].score < MIN_MATCH) return [];

  let q = supabase.from('catalog_items').select('*').in('product_id', ranked.map((r) => r.productId));
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
  const available = ranked.filter((r) => byProduct.has(r.productId));
  return pickSimilar(available, (id) => byProduct.get(id)?.category_id ?? null).map((r) => byProduct.get(r.productId)!);
}
