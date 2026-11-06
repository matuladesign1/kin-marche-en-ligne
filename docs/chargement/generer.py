"""Animation de chargement Kin Marché : icônes SVG et page d'aperçu.

Source unique des icônes : apps/mobile/src/components/loader/icons.json (utilisé tel quel par l'application).
Ce script écrit :
  - icones/<produit>.svg : chaque icône au trait (48 × 48, trait 2,6, rouge Kin Marché + détail turquoise du logo « ligne ») ;
  - apercu.html          : l'écran de chargement animé, mêmes durées et mêmes courbes que KinLoader.tsx.
Usage : python3 docs/chargement/generer.py
"""
import base64
import json
from pathlib import Path

ICI = Path(__file__).resolve().parent
RACINE = ICI.parent.parent
ICONES = json.loads((RACINE / 'apps/mobile/src/components/loader/icons.json').read_text(encoding='utf-8'))
LOGO = RACINE / 'apps/mobile/assets/images/logo-ball.png'
ROUGE, TURQUOISE = '#CE0000', '#1CB7B8'


def svg_icone(icone: dict) -> str:
    traits = '\n'.join(
        f'  <path d="{p["d"]}" stroke="{TURQUOISE if p.get("accent") else ROUGE}"/>' for p in icone['paths']
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none" '
        f'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">\n'
        f'  <title>{icone["label"]}</title>\n{traits}\n</svg>\n'
    )


def main() -> None:
    dossier = ICI / 'icones'
    dossier.mkdir(exist_ok=True)
    for i, icone in enumerate(ICONES, start=1):
        (dossier / f'{i:02d}-{icone["key"]}.svg').write_text(svg_icone(icone), encoding='utf-8')
    logo = 'data:image/png;base64,' + base64.b64encode(LOGO.read_bytes()).decode()
    page = (ICI / 'apercu.modele.html').read_text(encoding='utf-8')
    page = page.replace('__ICONES__', json.dumps(ICONES, ensure_ascii=False)).replace('__LOGO__', logo)
    (ICI / 'apercu.html').write_text(page, encoding='utf-8')
    print(f'{len(ICONES)} icônes et apercu.html écrits dans {ICI}')


if __name__ == '__main__':
    main()
