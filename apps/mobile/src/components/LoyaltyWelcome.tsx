import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { LoyaltyCardMini } from '@/components/LoyaltyCard';
import { Button, T } from '@/components/ui';
import { useLoyalty } from '@/hooks/data';
import { formatCdf, formatPoints } from '@/lib/format';
import { isTier, welcomeKey } from '@/lib/loyalty';
import { radius, spacing } from '@/lib/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useSettings } from '@/providers/SettingsProvider';

/**
 * Après l'inscription ou une connexion : présente la carte Kin Marché Fidélité
 * (ou la carte Argent à venir). Une seule fois par connexion, pas à chaque ouverture.
 */
export function LoyaltyWelcome() {
  const { session } = useAuth();
  const { t, language, colors } = useSettings();
  const { width } = useWindowDimensions();
  const q = useLoyalty();
  const [visible, setVisible] = useState(false);
  const key = session ? `${welcomeKey(session.user.id)}.${session.user.last_sign_in_at ?? ''}` : null;

  useEffect(() => {
    if (!key || !q.data) return;
    let alive = true;
    AsyncStorage.getItem(key).then((seen) => { if (alive && !seen) setVisible(true); }).catch(() => undefined);
    return () => { alive = false; };
  }, [key, q.data]);

  if (!visible || !q.data || !key) return null;
  const { card } = q.data;
  const hasCard = card.card_status !== 'none' && !!card.card_number && isTier(card.tier);
  const close = () => {
    setVisible(false);
    AsyncStorage.setItem(key, '1').catch(() => undefined);
  };
  const open = () => {
    close();
    router.push('/loyalty');
  };
  const sheetWidth = Math.min(width - spacing.lg * 2, 440);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t('common.close')}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, width: sheetWidth }]} onPress={() => undefined}>
          <T size="xl" weight="800" style={{ textAlign: 'center' }}>
            {hasCard ? t('loyalty.welcome.title') : t('loyalty.welcome.titleNoCard')}
          </T>
          <LoyaltyCardMini
            number={hasCard ? card.card_number : card.phone_card_number}
            name={card.full_name}
            tier={hasCard && isTier(card.tier) ? card.tier : 'silver'}
            points={hasCard ? card.points_balance : undefined}
            suspended={card.card_status === 'suspended'}
            pending={!hasCard}
            width={sheetWidth - spacing.lg * 2}
          />
          <T size="sm" style={{ textAlign: 'center', lineHeight: 20 }}>
            {hasCard
              ? t('loyalty.welcome.text', { points: formatPoints(card.points_balance, language) })
              : t('loyalty.welcome.noCard', { amount: formatCdf(card.enroll_min_cdf, language) })}
          </T>
          <Button title={t('loyalty.welcome.open')} icon="card-outline" onPress={open} />
          <Button title={t('loyalty.welcome.later')} variant="ghost" onPress={close} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: spacing.xxl },
  sheet: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
});
