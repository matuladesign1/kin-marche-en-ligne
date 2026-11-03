import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useId, useMemo } from 'react';
import { PixelRatio, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Defs, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';
import { code128Bars } from '@/lib/code128';
import type { LoyaltyTier } from '@/lib/types';
import { useSettings } from '@/providers/SettingsProvider';

// Carte Kin Marché Fidélité numérique, sur le modèle de la carte du programme :
// en-tête blanc avec le logo, fond métal (Argent, Gold, Platinum), niveau, nom,
// numéro (= téléphone), QR code et code-barres Code 128 du numéro, lisibles en caisse.

const LOGO = require('../../assets/images/loyalty/km-logo-h.png');
const LOGO_RATIO = 900 / 241;

interface CardTheme {
  stops: [number, string][];
  text: string;
  sub: string;
  pillText: string;
  light: string;
  dark: string;
}

export const CARD_THEMES: Record<LoyaltyTier, CardTheme> = {
  silver: {
    stops: [[0, '#F6F7F9'], [0.3, '#C6C9CE'], [0.55, '#9B9FA6'], [0.78, '#EBECEF'], [1, '#B2B5BB']],
    text: '#0B0B0C', sub: '#1E2024', pillText: '#3A3D44', light: 'rgba(255,255,255,0.5)', dark: 'rgba(55,60,68,0.16)',
  },
  gold: {
    stops: [[0, '#FFF5CF'], [0.3, '#EDC766'], [0.55, '#B98A2E'], [0.8, '#F7DE8F'], [1, '#C89B3C']],
    text: '#271A00', sub: '#3B2905', pillText: '#6B4A08', light: 'rgba(255,250,228,0.5)', dark: 'rgba(110,75,10,0.18)',
  },
  platinum: {
    stops: [[0, '#626A75'], [0.3, '#2C3138'], [0.55, '#9CA4AF'], [0.8, '#3B4149'], [1, '#1E2227']],
    text: '#FFFFFF', sub: '#E7EAEE', pillText: '#23272D', light: 'rgba(255,255,255,0.2)', dark: 'rgba(0,0,0,0.28)',
  },
};

/** Fond métal satiné (dégradé + reflets en biais). */
function Metal({ tier }: { tier: LoyaltyTier }) {
  const th = CARD_THEMES[tier];
  const id = `kmmetal${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {th.stops.map(([o, c]) => <Stop key={o} offset={o} stopColor={c} />)}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      <Polygon points="0,16 100,-8 100,9 0,38" fill={th.light} />
      <Polygon points="0,50 100,28 100,37 0,62" fill={th.dark} />
      <Polygon points="0,76 100,54 100,69 0,95" fill={th.light} />
    </Svg>
  );
}

/** Code-barres Code 128 (jeu C pour le numéro de carte), barres calées sur les pixels. */
export function Barcode({ value, width, height }: { value: string; width: number; height: number }) {
  const { bars, modules } = useMemo(() => code128Bars(value), [value]);
  const quiet = 8;
  const unit = Math.max(1, PixelRatio.roundToNearestPixel(width / (modules + quiet * 2)));
  const w = unit * (modules + quiet * 2);
  return (
    <Svg width={w} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={0} y={0} width={w} height={height} fill="#FFFFFF" />
      {bars.map(([x, bw]) => <Rect key={x} x={(x + quiet) * unit} y={0} width={bw * unit} height={height} fill="#000000" />)}
    </Svg>
  );
}

export interface LoyaltyCardProps {
  number: string;
  name: string | null;
  tier: LoyaltyTier;
  /** Téléphone affiché sous le numéro (par défaut : le numéro de carte). */
  phone?: string | null;
  suspended?: boolean;
  width?: number;
}

/** Carte complète, à présenter en caisse. */
export function LoyaltyCard({ number, name, tier, phone, suspended, width: wanted }: LoyaltyCardProps) {
  const { t } = useSettings();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(wanted ?? screen - 32, 440);
  const th = CARD_THEMES[tier];
  const tierLabel = t(`loyalty.tier.${tier}`);
  return (
    <View style={[styles.card, { width }]} accessible accessibilityLabel={t('loyalty.cardA11y', { tier: tierLabel, number })}>
      <View style={[styles.head, { paddingVertical: width * 0.045 }]}>
        <Image source={LOGO} style={{ width: width * 0.52, aspectRatio: LOGO_RATIO }} contentFit="contain" />
      </View>
      <View style={styles.headBar} />
      <View style={[styles.body, { paddingVertical: width * 0.06, gap: width * 0.026 }]}>
        <Metal tier={tier} />
        <View style={[styles.pill, { paddingVertical: width * 0.022, paddingHorizontal: width * 0.09 }]}>
          <Text style={[styles.pillText, { color: th.pillText, fontSize: width * 0.05 }]}>{t('loyalty.member', { tier: tierLabel }).toUpperCase()}</Text>
        </View>
        {suspended ? (
          <View style={styles.suspended}><Text style={styles.suspendedText}>{t('loyalty.suspendedBadge')}</Text></View>
        ) : null}
        {name ? (
          <Text style={[styles.name, { color: th.text, fontSize: width * 0.066 }]} numberOfLines={2} adjustsFontSizeToFit>{name.toUpperCase()}</Text>
        ) : null}
        <Text style={[styles.number, { color: th.text, fontSize: width * 0.062 }]}>{number}</Text>
        <Text style={[styles.phone, { color: th.sub, fontSize: width * 0.037 }]} numberOfLines={1} adjustsFontSizeToFit>
          {t('loyalty.phoneLine', { phone: phone ?? number })}
        </Text>
        <View style={[styles.qrBox, { padding: width * 0.04, marginTop: width * 0.015, opacity: suspended ? 0.3 : 1 }]}>
          <QRCode value={number} size={Math.round(width * 0.6)} ecl="M" quietZone={0} backgroundColor="#FFFFFF" color="#000000" />
        </View>
        <Text style={[styles.caption, { color: th.sub, fontSize: width * 0.035 }]}>{t('loyalty.qrCaption')}</Text>
        <View style={[styles.barBox, { paddingHorizontal: width * 0.04, paddingVertical: width * 0.03, opacity: suspended ? 0.3 : 1 }]}>
          <Barcode value={number} width={width * 0.66} height={Math.round(width * 0.13)} />
          <Text style={[styles.barText, { fontSize: width * 0.044 }]}>{number}</Text>
        </View>
        <Text style={[styles.caption, { color: th.sub, fontSize: width * 0.035 }]}>{t('loyalty.barCaption')}</Text>
      </View>
      <View style={styles.foot}>
        <Text style={[styles.footText, { fontSize: Math.max(10, width * 0.028) }]}>{t('loyalty.cardFooter')}</Text>
      </View>
    </View>
  );
}

/**
 * Carte réduite (format carte bancaire) : compte, accueil, bienvenue.
 * `pending` : carte pas encore émise (aperçu avec le futur numéro, sans codes).
 */
export function LoyaltyCardMini({ number, name, tier, points, suspended, pending, width: wanted }: {
  number: string | null; name: string | null; tier: LoyaltyTier; points?: number; suspended?: boolean; pending?: boolean; width?: number;
}) {
  const { t } = useSettings();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(wanted ?? screen - 32, 440);
  const height = width / 1.586;
  const th = CARD_THEMES[tier];
  const tierLabel = t(`loyalty.tier.${tier}`);
  const shown = number ?? '243 ••• ••• •••';
  return (
    <View style={[styles.mini, { width, height }]} accessible
      accessibilityLabel={pending ? t('loyalty.pendingA11y') : t('loyalty.cardA11y', { tier: tierLabel, number: shown })}>
      <View style={[styles.miniHead, { height: height * 0.27 }]}>
        <Image source={LOGO} style={{ height: height * 0.17, aspectRatio: LOGO_RATIO }} contentFit="contain" />
        <View style={[styles.pillSm, { backgroundColor: tier === 'platinum' ? '#2C3138' : tier === 'gold' ? '#B98A2E' : '#6B7078' }]}>
          <Text style={[styles.pillSmText, { fontSize: Math.max(9, width * 0.028) }]}>{t('loyalty.member', { tier: tierLabel }).toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.miniBar} />
      <View style={[styles.miniBody, { padding: width * 0.05 }]}>
        <Metal tier={tier} />
        {pending ? (
          <View style={styles.pendingTag}>
            <Ionicons name="lock-closed" size={12} color="#FFFFFF" />
            <Text style={styles.pendingText}>{t('loyalty.pendingTag')}</Text>
          </View>
        ) : suspended ? (
          <View style={[styles.pendingTag, { backgroundColor: '#B42318' }]}><Text style={styles.pendingText}>{t('loyalty.suspendedBadge')}</Text></View>
        ) : null}
        <View style={{ flex: 1 }} />
        {name ? <Text style={[styles.miniName, { color: th.text, fontSize: width * 0.056 }]} numberOfLines={1} adjustsFontSizeToFit>{name.toUpperCase()}</Text> : null}
        <View style={styles.miniRow}>
          <Text style={[styles.miniNumber, { color: th.text, fontSize: width * 0.052 }]} numberOfLines={1}>{shown}</Text>
          {points != null && !pending ? (
            <View style={styles.miniPoints}>
              <Text style={[styles.miniPointsValue, { color: th.text, fontSize: width * 0.06 }]}>{points.toLocaleString('fr-FR')}</Text>
              <Text style={[styles.miniPointsLabel, { color: th.sub }]}>{t('loyalty.pointsShort')}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center', borderTopLeftRadius: 34, borderTopRightRadius: 34, borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
    overflow: 'hidden', backgroundColor: '#FFFFFF', elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  head: { backgroundColor: '#FFFFFF', alignItems: 'center' },
  headBar: { height: 6, marginHorizontal: '10%', backgroundColor: '#5B6270' },
  body: { alignItems: 'center', paddingHorizontal: 16, overflow: 'hidden' },
  pill: { backgroundColor: '#FFFFFF', borderRadius: 999, elevation: 2, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  pillText: { fontWeight: '800', letterSpacing: 2.5, textAlign: 'center' },
  suspended: { backgroundColor: '#B42318', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  suspendedText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11, letterSpacing: 1.5 },
  name: { fontWeight: '900', textAlign: 'center', letterSpacing: 0.3 },
  number: { fontWeight: '500', letterSpacing: 4, textAlign: 'center' },
  phone: { fontWeight: '500', letterSpacing: 2.2, textAlign: 'center' },
  qrBox: { backgroundColor: '#FFFFFF', borderRadius: 18 },
  caption: { fontWeight: '600', letterSpacing: 3.5, textAlign: 'center' },
  barBox: { backgroundColor: '#FFFFFF', borderRadius: 14, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  barText: { color: '#000000', fontWeight: '700', letterSpacing: 1 },
  foot: { backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingVertical: 12 },
  footText: { color: '#4B5563', fontWeight: '700', letterSpacing: 0.8, textAlign: 'center', lineHeight: 15 },

  mini: {
    alignSelf: 'center', borderRadius: 18, overflow: 'hidden', backgroundColor: '#FFFFFF', elevation: 4,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  miniHead: { backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  miniBar: { height: 4, backgroundColor: '#5B6270' },
  miniBody: { flex: 1, overflow: 'hidden' },
  pillSm: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillSmText: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 1.2 },
  pendingTag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(17,24,39,0.72)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pendingText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11, letterSpacing: 0.5 },
  miniName: { fontWeight: '900', letterSpacing: 0.3 },
  miniRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  miniNumber: { fontWeight: '600', letterSpacing: 2.5, flexShrink: 1 },
  miniPoints: { alignItems: 'flex-end' },
  miniPointsValue: { fontWeight: '900' },
  miniPointsLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
