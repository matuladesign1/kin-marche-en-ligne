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
  if adb shell pidof "$PKG" >/dev/null 2>&1; then echo "OK : application vivante ($1)"; else echo "PLANTAGE : application fermée ($1)"; fi
}
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
open_url() { adb shell am start -W -a android.intent.action.VIEW -d "$1" "$PKG" >/dev/null 2>&1; }

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 50; shot 01-lancement; alive lancement

open_url "kinmarche://stores"
sleep 25; shot 02-magasins; alive magasins
tap_text "Utiliser ma position|Use my location" magasins
sleep 20; shot 03-magasins-position; alive "magasins + position"

open_url "kinmarche://addresses/new"
sleep 25; shot 04-adresse; alive adresse
tap_text "Enregistrer ma position GPS|Save my current GPS" adresse
sleep 20; shot 05-adresse-gps; alive "adresse + GPS"

open_url "kinmarche://sign-in"
sleep 15; shot 06-connexion; alive connexion

adb logcat -d -b all > "$OUT/logcat.txt" 2>/dev/null || true
adb logcat -d -b crash > "$OUT/crash.txt" 2>/dev/null || true
echo "===== Plantages (crash) ====="
head -150 "$OUT/crash.txt"
echo "===== Erreurs JavaScript et natives ====="
grep -n -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|JavascriptException|ExceptionsManager|Invariant|TypeError|ReferenceError|RangeError|Unhandled|SIGSEGV|SIGABRT|libc  :|DEBUG   :" "$OUT/logcat.txt" | grep -v -i "dex2oat" | head -200
exit 0
