// Empreinte visuelle des photos de produits (Blurhash 9 × 9, algorithme de référence de Wolt, licence MIT).
// Même calcul que le téléphone (expo-image) : la recherche par photo compare ces empreintes.

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function encode83(value: number, length: number): string {
  let s = '';
  for (let i = 1; i <= length; i++) s += B83[Math.floor(value / Math.pow(83, length - i)) % 83];
  return s;
}

function toLinear(v: number): number {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function toSRGB(v: number): number {
  const x = Math.max(0, Math.min(1, v));
  return x <= 0.0031308 ? Math.trunc(x * 12.92 * 255 + 0.5) : Math.trunc((1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255 + 0.5);
}

const signPow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

/** Empreinte de pixels RGBA (largeur × hauteur), 9 × 9 composantes : chaîne de 166 caractères commençant par « | ». */
export function encodeBlurhash(pixels: Uint8ClampedArray, width: number, height: number, cx = 9, cy = 9): string {
  const factors: [number, number, number][] = [];
  for (let y = 0; y < cy; y++) {
    for (let x = 0; x < cx; x++) {
      const norm = x === 0 && y === 0 ? 1 : 2;
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < height; j++) {
        const cosY = Math.cos((Math.PI * y * j) / height);
        for (let i = 0; i < width; i++) {
          const basis = norm * Math.cos((Math.PI * x * i) / width) * cosY;
          const p = 4 * (i + j * width);
          r += basis * toLinear(pixels[p]);
          g += basis * toLinear(pixels[p + 1]);
          b += basis * toLinear(pixels[p + 2]);
        }
      }
      const scale = 1 / (width * height);
      factors.push([r * scale, g * scale, b * scale]);
    }
  }
  const [dc, ...ac] = factors;
  let hash = encode83(cx - 1 + (cy - 1) * 9, 1);
  let maxValue = 1;
  if (ac.length) {
    const actualMax = Math.max(...ac.map((f) => Math.max(Math.abs(f[0]), Math.abs(f[1]), Math.abs(f[2]))));
    const q = Math.max(0, Math.min(82, Math.floor(actualMax * 166 - 0.5)));
    maxValue = (q + 1) / 166;
    hash += encode83(q, 1);
  } else {
    hash += encode83(0, 1);
  }
  hash += encode83((toSRGB(dc[0]) << 16) + (toSRGB(dc[1]) << 8) + toSRGB(dc[2]), 4);
  const quant = (v: number) => Math.max(0, Math.min(18, Math.floor(signPow(v / maxValue, 0.5) * 9 + 9.5)));
  for (const f of ac) hash += encode83(quant(f[0]) * 19 * 19 + quant(f[1]) * 19 + quant(f[2]), 2);
  return hash;
}

/** Empreinte d'un fichier image choisi dans le navigateur (réduit à 96 px au plus, comme sur le téléphone). */
export async function blurhashFromFile(file: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * ratio));
    const h = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#FFFFFF';   // PNG transparent : fond blanc, comme dans l'application
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return encodeBlurhash(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}
