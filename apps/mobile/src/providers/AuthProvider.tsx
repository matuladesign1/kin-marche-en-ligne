import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from '@/lib/i18n';
import { presentLocal } from '@/lib/notify';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useSettings } from './SettingsProvider';

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const WELCOME_KEY = 'km.welcome.notified';

/**
 * Notification sur le téléphone dès l'inscription (« Bienvenue ») ou la connexion (« Content de vous revoir »).
 * Une seule fois par connexion réelle (date de dernière connexion du compte).
 */
async function welcomeOnce(user: User, t: TFunction) {
  const stamp = `${user.id}:${user.last_sign_in_at ?? ''}`;
  try {
    if ((await AsyncStorage.getItem(WELCOME_KEY)) === stamp) return;
    await AsyncStorage.setItem(WELCOME_KEY, stamp);
  } catch {
    return;
  }
  const first = String(user.user_metadata?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
  const isNew = Date.now() - Date.parse(user.created_at) < 10 * 60_000;
  const title = isNew
    ? (first ? t('notif.welcome.title', { name: first }) : t('notif.welcome.titleNoName'))
    : (first ? t('notif.welcomeBack.title', { name: first }) : t('notif.welcomeBack.titleNoName'));
  await presentLocal({
    title,
    body: isNew ? t('notif.welcome.body') : t('notif.welcomeBack.body'),
    data: { kind: 'welcome' },
    channel: 'general',
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useSettings();
  const tRef = useRef(t);
  tRef.current = t;
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    // ensure_profile crée le profil client si le compte est antérieur à l'installation.
    const { data, error } = await supabase.rpc('ensure_profile');
    if (!error && data) setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Différé : ne pas appeler Supabase directement dans le callback d'auth.
      setTimeout(() => {
        loadProfile(s).finally(() => setLoading(false));
        if (event === 'SIGNED_IN' && s?.user) welcomeOnce(s.user, tRef.current).catch(() => undefined);
      }, 0);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value: AuthValue = {
    session,
    profile,
    loading,
    refreshProfile: () => loadProfile(session),
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
