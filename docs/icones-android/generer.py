"""Kin Marché en ligne : icônes et logos générés à partir des deux visuels officiels.

  sources/km-logo-carre.png  carré arrondi rouge, logo en couleurs  → icône de l'application, logos
  sources/km-logo-rond.png   rond rouge, logo blanc                  → icône de notification, icône monochrome

Le dégradé rouge des visuels est reconstruit (ajustement quadratique, écart moyen < 1 niveau)
pour pouvoir séparer le logo du fond pixel par pixel (alpha minimal), puis le recomposer
à toutes les tailles sans bord blanc ni halo.

Usage : python3 generer.py <dossier sources> <dossier de sortie>
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
BOX = (14, 1987)          # forme (carré arrondi / disque) dans les visuels 2000 × 2000
SIDE = BOX[1] - BOX[0]    # 1973 px
LOGO_Y = (690, 1215)      # bandeau du logo (anneau U, K, chariot, M, trait)
TEXT_Y = (1680, 1850)     # « En ligne »


def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert('RGBA')).astype(np.float64)


def fit_gradient(a):
    al = a[..., 3]
    bg = (al == 255) & (a[..., 1] < 8) & (a[..., 2] < 8)
    yy, xx = np.where(bg)
    sel = np.random.default_rng(0).choice(len(xx), min(400000, len(xx)), replace=False)
    x, y = xx[sel], yy[sel]
    X = np.stack([np.ones_like(x), x, y, x * x, y * y, x * y], 1).astype(np.float64)
    coef, *_ = np.linalg.lstsq(X, a[y, x, 0], rcond=None)
    return coef


def red_at(coef, x, y):
    return coef[0] + coef[1] * x + coef[2] * y + coef[3] * x * x + coef[4] * y * y + coef[5] * x * y


def unmix(a, coef, white_only=False):
    """Calque du logo (RGBA, flottants 0..1) : alpha minimal au-dessus du fond rouge reconstruit."""
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    b = np.clip(red_at(coef, xx, yy), 1, 254)
    p = a[..., :3]
    if white_only:
        alpha = np.clip(np.maximum.reduce([(p[..., 0] - b) / (255 - b), p[..., 1] / 255, p[..., 2] / 255]), 0, 1)
        rgb = np.ones_like(p)
    else:
        a_r = np.where(p[..., 0] >= b, (p[..., 0] - b) / (255 - b), (b - p[..., 0]) / b)
        alpha = np.clip(np.maximum.reduce([a_r, p[..., 1] / 255, p[..., 2] / 255]), 0, 1)
        safe = np.maximum(alpha, 1e-6)
        bg = np.stack([b, np.zeros_like(b), np.zeros_like(b)], -1)
        rgb = np.clip((bg + (p - bg) / safe[..., None]) / 255, 0, 1)
    alpha[alpha < 0.05] = 0
    # Seulement le logo et « En ligne » : rien près du bord de la forme.
    keep = np.zeros_like(alpha, dtype=bool)
    keep[LOGO_Y[0]:LOGO_Y[1], 120:1880] = True
    keep[TEXT_Y[0]:TEXT_Y[1], 700:1300] = True
    alpha = np.where(keep & (a[..., 3] == 255), alpha, 0)
    return np.dstack([rgb, alpha])


def to_img(layer):
    return Image.fromarray(np.uint8(np.round(np.clip(layer, 0, 1) * 255)), 'RGBA')


def gradient(coef, size, x0, y0, scale):
    """Dégradé rouge : le pixel (u, v) correspond au point (x0 + u·scale, y0 + v·scale) du visuel."""
    v, u = np.mgrid[0:size[1], 0:size[0]].astype(np.float64)
    r = np.clip(red_at(coef, x0 + (u + 0.5) * scale, y0 + (v + 0.5) * scale), 0, 255)
    z = np.zeros_like(r)
    return Image.fromarray(np.uint8(np.dstack([r, z, z, np.full_like(r, 255)]).round()), 'RGBA')


def resized(img, size):
    """Redimensionnement en alpha prémultiplié (pas de halo sombre sur les bords)."""
    return img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def place(canvas, layer, box_px, center):
    """Pose le calque (2000 px) en faisant correspondre la forme BOX à box_px pixels, centrée en center."""
    crop = layer.crop((BOX[0], BOX[0], BOX[1], BOX[1]))
    small = resized(crop, (box_px, box_px))
    canvas.alpha_composite(small, (round(center[0] - box_px / 2), round(center[1] - box_px / 2)))
    return canvas


def rounded_mask(size, radius, scale=4):
    big = Image.new('L', (size[0] * scale, size[1] * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size[0] * scale - 1, size[1] * scale - 1), radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


def disc_mask(d, scale=4):
    big = Image.new('L', (d * scale, d * scale), 0)
    ImageDraw.Draw(big).ellipse((0, 0, d * scale - 1, d * scale - 1), fill=255)
    return big.resize((d, d), Image.LANCZOS)


def save(img, name, size=None):
    if size:
        img = resized(img, (size, size)) if img.size != (size, size) else img
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


a1, a2 = load('km-logo-carre.png'), load('km-logo-rond.png')
coef1, coef2 = fit_gradient(a1), fit_gradient(a2)
logo = to_img(unmix(a1, coef1))                     # logo en couleurs + « En ligne »
# Visuel rond : le logo y est découpé (transparent) dans le disque rouge.
_yy, _xx = np.mgrid[0:2000, 0:2000]
DISC = np.clip(987.0 - np.hypot(_xx - 1000.5, _yy - 999.5) + 0.5, 0, 1)   # disque net, bord lissé
HOLES = DISC * (1 - a2[..., 3] / 255)                                      # 1 = logo découpé
_keep = np.zeros((2000, 2000), bool)
_keep[LOGO_Y[0]:LOGO_Y[1], 120:1880] = True
_keep[TEXT_Y[0]:TEXT_Y[1], 700:1300] = True
_hl = np.where(_keep, HOLES, 0)
_hl[_hl < 0.05] = 0
logo_w = Image.fromarray(np.uint8(np.dstack([np.full((2000, 2000, 3), 255.0), _hl * 255]).round()), 'RGBA')  # logo blanc
src_carre = Image.open(os.path.join(SRC, 'km-logo-carre.png')).convert('RGBA')

def only(layer, rows):
    arr = np.asarray(layer).copy()
    m = np.zeros(arr.shape[:2], bool)
    m[rows[0]:rows[1]] = True
    arr[..., 3] = np.where(m, arr[..., 3], 0)
    return Image.fromarray(arr, 'RGBA')

logo_main = only(logo, LOGO_Y)                     # sans « En ligne »

# ── Icône carrée pleine (iOS, Play Store, ancienne icône Android) ─────────────────
S = 1024
icon = gradient(coef1, (S, S), BOX[0], BOX[0], SIDE / S)
place(icon, logo, S, (S / 2, S / 2))
save(icon.convert('RGB'), 'icon.png')
save(icon.convert('RGB'), 'play-store-512.png', 512)

# ── Icône adaptative Android (108 dp : zone visible 72 dp, zone sûre 66 dp) ──────
visible = S * 72 / 108
safe = S * 66 / 108
offset = (S - visible) / 2
bg = gradient(coef1, (S, S), BOX[0] - offset * SIDE / visible, BOX[0] - offset * SIDE / visible, SIDE / visible)
save(bg.convert('RGB'), 'adaptive-icon-background.png')
fg = place(Image.new('RGBA', (S, S), (0, 0, 0, 0)), logo, round(safe), (S / 2, S / 2))
save(fg, 'adaptive-icon.png')
mono = place(Image.new('RGBA', (S, S), (0, 0, 0, 0)), logo_w, round(safe), (S / 2, S / 2))
save(mono, 'adaptive-icon-monochrome.png')

# ── Logos de l'application et de l'administration ───────────────────────────────
carre = src_carre.crop((BOX[0], BOX[0], BOX[1], BOX[1]))
save(resized(carre, (512, 512)), 'logo-square.png')
save(resized(carre, (256, 256)), 'admin-icon.png')
save(resized(carre, (48, 48)), 'favicon.png')

R = 512
rond = gradient(coef1, (R, R), BOX[0], BOX[0], SIDE / R)
lw = 0.80 * R                                          # logo à 80 % du diamètre
crop = logo_main.crop((150, LOGO_Y[0], 1850, LOGO_Y[1]))
bbox = crop.getbbox()
crop = crop.crop(bbox)
ls = resized(crop, (round(lw), round(lw * crop.height / crop.width)))
rond.alpha_composite(ls, (round((R - ls.width) / 2), round((R - ls.height) / 2)))
rond.putalpha(disc_mask(R))
save(rond, 'logo-round.png')

# Logo horizontal : bandeau rouge arrondi, logo puis « En ligne » rapproché.
W, H = 1200, 516
band = gradient(coef1, (W, H), BOX[0] + 140, BOX[0] + 640, 1.42)
main = logo_main.crop(logo_main.getbbox())
txt = logo.crop((700, TEXT_Y[0], 1300, TEXT_Y[1]))
txt = txt.crop(txt.getbbox())
mw = 1000
ms = resized(main, (mw, round(mw * main.height / main.width)))
k = mw / main.width
ts = resized(txt, (round(txt.width * k * 1.15), round(txt.height * k * 1.15)))
gap = 40
top = round((H - (ms.height + gap + ts.height)) / 2)
band.alpha_composite(ms, (round((W - ms.width) / 2), top))
band.alpha_composite(ts, (round((W - ts.width) / 2), top + ms.height + gap))
band.putalpha(rounded_mask((W, H), 64))
save(band, 'logo-wide.png')

# Écran de démarrage : logo seul (posé sur un fond rouge uni).
# Carré transparent, logo à 58 % de la largeur : tient dans le cercle de l'écran de démarrage d'Android 12+.
splash_src = logo.crop(logo.getbbox())
C = 1200
sw = round(C * 0.58)
sl = resized(splash_src, (sw, round(sw * splash_src.height / splash_src.width)))
splash_img = Image.new('RGBA', (C, C), (0, 0, 0, 0))
splash_img.alpha_composite(sl, (round((C - sl.width) / 2), round((C - sl.height) / 2)))
save(splash_img, 'splash-logo.png')
centre = red_at(coef1, 1000, 1000)
print('Fond de l’écran de démarrage : #%02X0000' % round(centre))

# ── Icône de notification (barre d'état) : disque blanc, logo découpé ───────────
holes_logo = np.where(np.arange(2000)[:, None] >= LOGO_Y[0], 1, 0) * np.where(np.arange(2000)[:, None] < LOGO_Y[1], 1, 0) * _hl
mask_logo = Image.fromarray(np.uint8(holes_logo * 255), 'L').filter(ImageFilter.MaxFilter(9))   # traits épaissis
al = DISC * (1 - np.asarray(mask_logo).astype(np.float64) / 255)                             # « En ligne » rebouché
note = Image.new('RGBA', (2000, 2000), (255, 255, 255, 0))
note.putalpha(Image.fromarray(np.uint8(al * 255), 'L'))
note = note.crop((BOX[0], BOX[0], BOX[1], BOX[1]))
small = resized(note, (88, 88))
notif = Image.new('RGBA', (96, 96), (255, 255, 255, 0))
notif.alpha_composite(small, (4, 4))
save(notif, 'notification-icon.png')

# ── Jeu Android complet (documentation) et aperçu des masques ───────────────────
dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for d, f in dens.items():
    n48, n108, n24 = round(48 * f), round(108 * f), round(24 * f)
    save(fg, f'android/mipmap-{d}/ic_launcher_foreground.png', n108)
    save(bg.convert('RGB'), f'android/mipmap-{d}/ic_launcher_background.png', n108)
    save(mono, f'android/mipmap-{d}/ic_launcher_monochrome.png', n108)
    sq = resized(icon, (n48, n48))
    sq.putalpha(rounded_mask((n48, n48), round(n48 * 0.18)))
    save(sq, f'android/mipmap-{d}/ic_launcher.png')
    rd = resized(icon, (n48, n48))
    rd.putalpha(disc_mask(n48))
    save(rd, f'android/mipmap-{d}/ic_launcher_round.png')
    save(notif, f'android/drawable-{d}/notification_icon.png', n24)

# Aperçu : formes des lanceurs Android, icône de notification, logos.
full = Image.alpha_composite(bg, fg)
cut = full.crop((round(offset), round(offset), round(offset + visible), round(offset + visible))).resize((300, 300), Image.LANCZOS)
sheet = Image.new('RGBA', (1720, 760), (242, 242, 242, 255))
shapes = [disc_mask(300), rounded_mask((300, 300), 90), rounded_mask((300, 300), 40)]
for i, m in enumerate(shapes):
    t = cut.copy(); t.putalpha(m); sheet.alpha_composite(t, (20 + i * 330, 20))
mono_cut = mono.crop((round(offset), round(offset), round(offset + visible), round(offset + visible))).resize((300, 300), Image.LANCZOS)
dark = Image.new('RGBA', (300, 300), (40, 52, 70, 255)); dark.putalpha(disc_mask(300))
dark.alpha_composite(Image.composite(Image.new('RGBA', (300, 300), (200, 225, 255, 255)), Image.new('RGBA', (300, 300), (0, 0, 0, 0)), mono_cut.split()[3]))
sheet.alpha_composite(dark, (1010, 20))
nb = Image.new('RGBA', (300, 300), (30, 30, 30, 255))
nb.alpha_composite(resized(notif, (96, 96)), (20, 20))
nb.alpha_composite(resized(notif, (24, 24)), (140, 30))
tinted = Image.new('RGBA', (96, 96), (round(centre), 0, 0, 255)); tinted.putalpha(notif.split()[3])
nb.alpha_composite(tinted, (20, 150))
sheet.alpha_composite(nb, (1340, 20))
sheet.alpha_composite(resized(band, (600, 258)), (20, 360))
sheet.alpha_composite(resized(rond, (220, 220)), (660, 380))
sheet.alpha_composite(resized(carre, (220, 220)), (910, 380))
splash = Image.new('RGBA', (300, 360), (round(centre), 0, 0, 255))
sp = resized(splash_src, (240, round(240 * splash_src.height / splash_src.width)))
splash.alpha_composite(sp, (30, round((360 - sp.height) / 2)))
sheet.alpha_composite(splash, (1160, 380))
sheet.save(os.path.join(OUT, 'apercu.png'))
print('ok')
