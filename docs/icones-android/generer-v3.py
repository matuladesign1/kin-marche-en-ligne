"""Kin Marché en ligne : icône de l'application, icône de notification et logo « ligne » (novembre 2026, v3).

  sources/km-icone-blanche.png  carré arrondi clair, logo en couleurs  → icône de l'application (toutes tailles)
  sources/km-logo-ligne.png     logo « ligne » → notifications push, animation de chargement (tracé en rouge sur boule blanche)

Le fond clair du carré est reconstruit (ajustement quadratique par couleur) pour séparer le logo du fond pixel par
pixel (alpha minimal), puis le recomposer à toutes les tailles sans halo. Le logo « ligne » est séparé du blanc de la
même façon : posé sur du blanc, il redonne exactement l'image d'origine.
Android impose une icône de notification blanche (silhouette) : c'est la forme du logo, teintée en turquoise par le système.

Les autres logos de l'application (bandeau, rond, carré rouge) restent ceux de generer.py.
Usage : python3 generer-v3.py <dossier sources> <dossier de sortie>
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
BOX = (54, 1943)              # carré arrondi dans km-icone-blanche.png (2000 × 2000)
SIDE = BOX[1] - BOX[0]
LOGO_Y, LOGO_X = (730, 1250), (140, 1890)


def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert('RGB')).astype(np.float64)


def to_img(arr):
    return Image.fromarray(np.uint8(np.round(np.clip(arr, 0, 1) * 255)), 'RGBA')


def resized(img, size):
    return img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def rounded_mask(size, radius, scale=4):
    big = Image.new('L', (size[0] * scale, size[1] * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size[0] * scale - 1, size[1] * scale - 1), radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


def disc_mask(d, scale=4):
    big = Image.new('L', (d * scale, d * scale), 0)
    ImageDraw.Draw(big).ellipse((0, 0, d * scale - 1, d * scale - 1), fill=255)
    return big.resize((d, d), Image.LANCZOS)


def save(img, name):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return img


def unmix(p, b, keep):
    """Calque RGBA (0..1) du logo au-dessus du fond b : alpha minimal par pixel."""
    up = np.where(p >= b, (p - b) / np.maximum(255 - b, 1), (b - p) / np.maximum(b, 1))
    alpha = np.clip(up.max(axis=2), 0, 1)
    alpha[alpha < 0.06] = 0
    alpha = np.where(keep, alpha, 0)
    rgb = np.clip((b + (p - b) / np.maximum(alpha, 1e-6)[..., None]) / 255, 0, 1)
    return np.dstack([rgb, alpha])


# ── 1. Icône de l'application : fond clair reconstruit + logo en couleurs ────────────────────
a1 = load('km-icone-blanche.png')
yy, xx = np.mgrid[0:2000, 0:2000]
inner = (xx > BOX[0] + 80) & (xx < BOX[1] - 80) & (yy > BOX[0] + 80) & (yy < BOX[1] - 80)
chroma = a1.max(axis=2) - a1.min(axis=2)
bgpix = inner & ~((yy > LOGO_Y[0] - 40) & (yy < LOGO_Y[1] + 40)) & (chroma < 10) & (a1.min(axis=2) > 200)
ys, xs = np.where(bgpix)
sel = np.random.default_rng(0).choice(len(xs), min(300000, len(xs)), replace=False)
xs, ys = xs[sel].astype(np.float64), ys[sel].astype(np.float64)
X = np.stack([np.ones_like(xs), xs, ys, xs * xs, ys * ys, xs * ys], 1)
coefs = [np.linalg.lstsq(X, a1[ys.astype(int), xs.astype(int), c], rcond=None)[0] for c in range(3)]


def bg_at(x, y):
    return np.stack([c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * y * y + c[5] * x * y for c in coefs], -1)


resid = np.abs(bg_at(xs, ys) - a1[ys.astype(int), xs.astype(int)]).mean()
print(f'fond reconstruit : écart moyen {resid:.2f} niveau(x)')
keep1 = (yy >= LOGO_Y[0]) & (yy < LOGO_Y[1]) & (xx >= LOGO_X[0]) & (xx < LOGO_X[1])
logo1 = unmix(a1, bg_at(xx.astype(np.float64), yy.astype(np.float64)), keep1)
logo1_img = to_img(logo1)


def gradient(size, x0, y0, scale):
    v, u = np.mgrid[0:size[1], 0:size[0]].astype(np.float64)
    rgb = np.clip(bg_at(x0 + (u + 0.5) * scale, y0 + (v + 0.5) * scale), 0, 255)
    return Image.fromarray(np.uint8(np.dstack([rgb, np.full(rgb.shape[:2], 255)]).round()), 'RGBA')


def place(canvas, layer, box_px, center):
    crop = layer.crop((BOX[0], BOX[0], BOX[1], BOX[1]))
    canvas.alpha_composite(resized(crop, (box_px, box_px)), (round(center[0] - box_px / 2), round(center[1] - box_px / 2)))
    return canvas


S = 1024
icon = place(gradient((S, S), BOX[0], BOX[0], SIDE / S), logo1_img, S, (S / 2, S / 2))
save(icon.convert('RGB'), 'icon.png')
save(resized(icon, (512, 512)).convert('RGB'), 'play-store-512.png')
fav = resized(icon, (48, 48)); fav.putalpha(rounded_mask((48, 48), 9)); save(fav, 'favicon.png')

visible, safe = S * 72 / 108, S * 66 / 108
offset = (S - visible) / 2
bg = gradient((S, S), BOX[0] - offset * SIDE / visible, BOX[0] - offset * SIDE / visible, SIDE / visible)
save(bg.convert('RGB'), 'adaptive-icon-background.png')
fg = place(Image.new('RGBA', (S, S), (0, 0, 0, 0)), logo1_img, round(safe), (S / 2, S / 2))
save(fg, 'adaptive-icon.png')
centre = bg_at(np.array(1000.0), np.array(1000.0))
print('Couleur de fond de l’icône adaptative : #%02X%02X%02X' % tuple(int(round(v)) for v in centre))

# Silhouette du logo (formes nettes) : icône monochrome Android 13 et icône de notification.
sil = np.clip((logo1[..., 3] - 0.3) / 0.4, 0, 1)
sil_img = Image.fromarray(np.uint8(sil * 255), 'L')


def white(mask):
    out = Image.new('RGBA', mask.size, (255, 255, 255, 0))
    out.putalpha(mask)
    return out


mono = place(Image.new('RGBA', (S, S), (0, 0, 0, 0)), white(sil_img), round(safe), (S / 2, S / 2))
save(mono, 'adaptive-icon-monochrome.png')

# ── 2. Logo « ligne » : PNG transparent (anneau blanc, lettres blanches, anneau et chariot turquoise) ──
L2 = Image.open(os.path.join(SRC, 'km-logo-ligne.png')).convert('RGBA')
al2 = np.asarray(L2.getchannel('A')).astype(np.float64)
al2[al2 < 20] = 0                                   # voile presque invisible autour du logo : ignoré
L2.putalpha(Image.fromarray(np.uint8(al2), 'L'))
badge = L2.crop((38, 38, 1959, 1959))               # l'anneau blanc touche le bord : diamètre 1921 px
teal = np.asarray(badge.convert('RGB')).reshape(-1, 3).astype(np.float64)
teal = teal[(np.asarray(badge.getchannel('A')).reshape(-1) > 200) & (teal[:, 0] < 80) & (teal[:, 1] > 140) & (teal[:, 2] > 130)].mean(axis=0)
print('Turquoise du logo « ligne » : #%02X%02X%02X' % tuple(int(round(v)) for v in teal))


ROUGE_ICONE = (230, 0, 36)                           # rouge des lettres de l'icône de l'application (#E60024)


def logo_ball(D):
    """Boule du logo : sphère blanche ; le logo « ligne » (contour et U K, chariot, M) y est tracé en rouge."""
    v, u = np.mgrid[0:D, 0:D].astype(np.float64)
    r = np.clip(np.hypot((u + 0.5) / D - 0.36, (v + 0.5) / D - 0.30) / 0.75, 0, 1)
    g = np.interp(r, [0, 0.7, 1], [255, 243, 220])
    ball = Image.fromarray(np.uint8(np.dstack([g, g, g, np.full_like(g, 255)]).round()), 'RGBA')
    ball.putalpha(disc_mask(D))
    trace = Image.new('RGBA', badge.size, ROUGE_ICONE + (0,))
    trace.putalpha(badge.getchannel('A'))           # formes exactes du logo « ligne », en rouge
    ball.alpha_composite(resized(trace, (D, D)))
    return ball


save(logo_ball(512), 'logo-ball.png')

# ── 3. Icône de notification : silhouette blanche du logo « ligne » (anneau + logo), traits épaissis ──
thick = badge.getchannel('A').filter(ImageFilter.MaxFilter(11))
small = resized(white(thick), (88, 88))
notif = Image.new('RGBA', (96, 96), (255, 255, 255, 0))
notif.alpha_composite(small, (4, 4))
save(notif, 'notification-icon.png')

# ── 4. Écran de démarrage (fond blanc) : la boule du logo, même taille et même place que la première image de l'animation ──
C = 1200
D = round(C * 112 / 220)                            # image de 220 dp → boule de 112 dp
splash = Image.new('RGBA', (C, C), (0, 0, 0, 0))
splash.alpha_composite(logo_ball(D), ((C - D) // 2, (C - D) // 2))
save(splash, 'splash-logo.png')
sphere = logo_ball(360)

# ── 5. Jeu Android complet (documentation) et aperçu ─────────────────────────────────────────
for d, f in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
    n48, n108, n24 = round(48 * f), round(108 * f), round(24 * f)
    save(resized(fg, (n108, n108)), f'android/mipmap-{d}/ic_launcher_foreground.png')
    save(resized(bg, (n108, n108)).convert('RGB'), f'android/mipmap-{d}/ic_launcher_background.png')
    save(resized(mono, (n108, n108)), f'android/mipmap-{d}/ic_launcher_monochrome.png')
    sq = resized(icon, (n48, n48)); sq.putalpha(rounded_mask((n48, n48), round(n48 * 0.18)))
    save(sq, f'android/mipmap-{d}/ic_launcher.png')
    rd = resized(icon, (n48, n48)); rd.putalpha(disc_mask(n48))
    save(rd, f'android/mipmap-{d}/ic_launcher_round.png')
    save(resized(notif, (n24, n24)), f'android/drawable-{d}/notification_icon.png')

full = Image.alpha_composite(bg, fg)
cut = full.crop((round(offset), round(offset), round(offset + visible), round(offset + visible))).resize((300, 300), Image.LANCZOS)
sheet = Image.new('RGBA', (1720, 400), (60, 64, 72, 255))
for i, m in enumerate([disc_mask(300), rounded_mask((300, 300), 90), rounded_mask((300, 300), 40)]):
    t = cut.copy(); t.putalpha(m); sheet.alpha_composite(t, (20 + i * 330, 20))
nb = Image.new('RGBA', (330, 300), (25, 25, 25, 255))
nb.alpha_composite(notif, (20, 20))
nb.alpha_composite(resized(notif, (48, 48)), (140, 40))
nb.alpha_composite(resized(notif, (24, 24)), (210, 52))
tint = Image.new('RGBA', (96, 96), tuple(int(round(x)) for x in teal) + (255,)); tint.putalpha(notif.split()[3])
nb.alpha_composite(tint, (20, 150))
sheet.alpha_composite(nb, (1010, 20))
red = Image.new('RGBA', (330, 300), (255, 255, 255, 255))
red.alpha_composite(resized(sphere, (180, 180)), (75, 60))
sheet.alpha_composite(red, (1370, 20))
sheet.save(os.path.join(OUT, 'apercu-v3.png'))
print('ok')
