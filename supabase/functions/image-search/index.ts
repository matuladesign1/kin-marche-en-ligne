import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply, serverSecret } from '../_shared/server.ts';

// Recherche par photo : Google Cloud Vision lit le texte de l'emballage, les logos
// et les étiquettes de l'image, puis on cherche ces termes dans le catalogue réel.
const MAX_BYTES = 4_000_000;
const STOP = new Set(['the', 'and', 'with', 'pour', 'avec', 'les', 'des', 'une', 'net', 'poids', 'ingredients', 'ingrédients', 'www', 'com']);

// Étiquettes Vision (anglais) → termes du catalogue (français).
const LABELS_FR: Record<string, string> = {
  rice: 'riz', bread: 'pain', milk: 'lait', water: 'eau', juice: 'jus', oil: 'huile', sugar: 'sucre', flour: 'farine',
  beer: 'bière', wine: 'vin', soda: 'soda', soft: 'soda', egg: 'oeuf', chicken: 'poulet', meat: 'viande', beef: 'boeuf',
  fish: 'poisson', cheese: 'fromage', butter: 'beurre', yogurt: 'yaourt', tomato: 'tomate', onion: 'oignon',
  banana: 'banane', apple: 'pomme', orange: 'orange', potato: 'pomme de terre', pasta: 'pâtes', coffee: 'café',
  tea: 'thé', chocolate: 'chocolat', biscuit: 'biscuit', cookie: 'biscuit', soap: 'savon', shampoo: 'shampooing',
  toothpaste: 'dentifrice', detergent: 'détergent', diaper: 'couche', salt: 'sel', spice: 'épice', noodle: 'nouilles',
  cereal: 'céréales', honey: 'miel', vegetable: 'légume', fruit: 'fruit', bottle: 'bouteille', can: 'conserve',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { user } = await currentUser(req);
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);
  const { image_base64, store_id } = await req.json().catch(() => ({}));
  if (typeof image_base64 !== 'string' || !image_base64) return reply({ error: 'INVALID_BODY' }, 400);
  if (image_base64.length * 0.75 > MAX_BYTES) return reply({ error: 'IMAGE_TOO_LARGE' }, 413);

  const admin = adminClient();
  const key = await serverSecret(admin, 'GOOGLE_MAPS_API_KEY');
  if (!key) return reply({ error: 'VISION_NOT_CONFIGURED' }, 503);

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{
      image: { content: image_base64 },
      features: [{ type: 'LOGO_DETECTION', maxResults: 3 }, { type: 'TEXT_DETECTION', maxResults: 1 }, { type: 'LABEL_DETECTION', maxResults: 8 }],
    }] }),
  });
  const json = await res.json().catch(() => ({}));
  const r = json?.responses?.[0];
  if (!res.ok || r?.error) return reply({ error: 'VISION_API_ERROR', status: res.status, detail: r?.error?.message ?? json?.error?.message ?? null }, 502);

  const logos: string[] = (r.logoAnnotations ?? []).map((l: any) => String(l.description));
  const words: string[] = String(r.fullTextAnnotation?.text ?? r.textAnnotations?.[0]?.description ?? '')
    .split(/[\s,.;:()\/\-]+/).map((w) => w.trim()).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w.toLowerCase()));
  const labels: string[] = (r.labelAnnotations ?? []).filter((l: any) => l.score >= 0.6)
    .map((l: any) => String(l.description).toLowerCase())
    .flatMap((l: string) => l.split(' ').map((w) => LABELS_FR[w] ?? null)).filter(Boolean) as string[];

  // Ordre de priorité : logo/marque, mots de l'emballage, catégories visuelles.
  const terms = [...new Set([...logos, ...words.slice(0, 10), ...labels])].slice(0, 16);
  const seen = new Map<string, any>();
  for (const term of terms) {
    const { data } = await admin.rpc('search_catalog', { p_query: term, p_store_id: store_id ?? null, p_limit: 12 });
    for (const item of data ?? []) {
      const prev = seen.get(item.inventory_id);
      seen.set(item.inventory_id, { ...item, _score: (prev?._score ?? 0) + (logos.includes(term) ? 3 : labels.includes(term) ? 1 : 2) });
    }
    if (seen.size >= 40) break;
  }
  const items = [...seen.values()].sort((a, b) => b._score - a._score || Number(b.in_stock) - Number(a.in_stock)).slice(0, 30)
    .map(({ _score, search_text, ...rest }) => rest);
  return reply({ terms, items });
});
