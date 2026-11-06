#!/usr/bin/env bash
# Parcours de test sur émulateur : lancement, magasins, bouton position, nouvelle adresse, bouton GPS.
set -u
OUT=smoke-out
PKG=cd.kinmarche.enligne
mkdir -p "$OUT"
APK=$(ls apk/*.apk | head -1)

adb logcat -G 16M || true
adb shell getprop ro.product.cpu.abilist
adb install -r -g "$APK" 2>&1 | tee "$OUT/install.txt"
adb logcat -c || true
adb emu geo fix 15.3139 -4.3317 || true

shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }
alive() {
  local n
  n=$(adb logcat -d -b crash 2>/dev/null | grep -c "FATAL EXCEPTION" || true)
  if [ "${n:-0}" -gt "${CRASHES:-0}" ]; then echo "PLANTAGE : l'application s'est fermée ($1)"; CRASHES=$n; return; fi
  if adb shell pidof "$PKG" >/dev/null 2>&1; then echo "OK : application ouverte ($1)"; else echo "PLANTAGE : application fermée ($1)"; fi
  adb shell uiautomator dump /sdcard/check.xml >/dev/null 2>&1
  if adb shell cat /sdcard/check.xml 2>/dev/null | grep -q -E "La carte n.a pas pu|The map could not"; then echo "CARTE EN ERREUR ($1)"; fi
}
CRASHES=0
tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml "$OUT/ui-$2.xml" >/dev/null 2>&1
  python3 - "$OUT/ui-$2.xml" "$1" > "$OUT/tap.txt" <<'PY'
import re, sys
try:
    x = open(sys.argv[1], encoding='utf-8').read()
except OSError:
    sys.exit(0)
pat = re.compile(sys.argv[2])
for m in re.finditer(r'<node [^>]*>', x):
    n = m.group(0)
    t = re.search(r'text="([^"]*)"', n)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if t and b and pat.search(t.group(1)):
        x1, y1, x2, y2 = map(int, b.groups())
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
  if [ -s "$OUT/tap.txt" ]; then adb shell input tap $(cat "$OUT/tap.txt"); echo "appui sur « $1 » ($(cat "$OUT/tap.txt"))"; else echo "texte introuvable : $1"; fi
}
# Taille de l'écran (les gestes en dépendent) et position GPS simulée envoyée plusieurs fois.
read -r W H <<< "$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1 | tr 'x' ' ')"
W=${W:-1080}; H=${H:-1920}
scroll_down() { adb shell input swipe $((W / 2)) $((H * 8 / 10)) $((W / 2)) $((H * 2 / 10)) 400; sleep 2; }
gps_fix() { for _ in 1 2 3 4 5 6; do adb emu geo fix 15.3139 -4.3317 >/dev/null 2>&1; sleep 2; done; }
open_url() { adb shell am start -W -a android.intent.action.VIEW -d "$1" "$PKG" >/dev/null 2>&1; }

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 40; shot 01-lancement; alive lancement

open_url "kinmarche://stores"
sleep 25; shot 02-magasins; alive magasins
tap_text "Utiliser ma position|Use my location" magasins
gps_fix; sleep 8; shot 03-magasins-position; alive "magasins + position"

open_url "kinmarche://addresses/new"
sleep 25; shot 04-adresse; alive adresse
scroll_down; scroll_down; scroll_down
shot 04b-adresse-bas
tap_text "Enregistrer ma position GPS|Save my current GPS" adresse
gps_fix; sleep 10; shot 05-adresse-gps; alive "adresse + GPS"

open_url "kinmarche://sign-in"
sleep 15; shot 06-connexion; alive connexion

adb logcat -d -b all > "$OUT/logcat.txt" 2>/dev/null || true
adb logcat -d -b crash > "$OUT/crash.txt" 2>/dev/null || true
echo "===== Plantages (crash) ====="
head -150 "$OUT/crash.txt"
echo "===== Erreurs JavaScript et natives ====="
grep -n -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|JavascriptException|ExceptionsManager|Invariant|TypeError|ReferenceError|RangeError|Unhandled|SIGSEGV|SIGABRT|libc  :|DEBUG   :" "$OUT/logcat.txt" | grep -v -i "dex2oat" | head -200
exit 0
