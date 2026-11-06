import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'facebook';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let cache: { at: number; value: Record<OAuthProvider, boolean> } | null = null;

/**
 * Fournisseurs réellement activés sur le serveur (Supabase → Authentication → Providers).
 * null si le serveur ne répond pas : on affiche alors les boutons et l'erreur éventuelle au clic.
 */
export async function enabledProviders(): Promise<Record<OAuthProvider, boolean> | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  if (!URL_ || !KEY) return null;
  try {
    const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } });
    if (!res.ok) return null;
    const json = (await res.json()) as { external?: Record<string, boolean> };
    const value = { google: !!json.external?.google, facebook: !!json.external?.facebook };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

// Le code de retour peut arriver deux fois (fenêtre de connexion et lien profond de l'application) :
// un seul échange par code.
const exchanges = new Map<string, Promise<{ ok: boolean; error?: string }>>();

export function exchangeCode(code: string): Promise<{ ok: boolean; error?: string }> {
  let p = exchanges.get(code);
  if (!p) {
    p = supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
      if (!error) return { ok: true };
      // Déjà échangé par l'autre chemin : la session est là, tout va bien.
      const { data } = await supabase.auth.getSession();
      return data.session ? { ok: true } : { ok: false, error: error.message };
    });
    exchanges.set(code, p);
  }
  return p;
}

/**
 * Connexion Google / Facebook via Supabase (PKCE). Le fournisseur doit être activé dans
 * Supabase → Authentication → Providers, et « kinmarche://** » autorisé dans URL Configuration.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<{ ok: boolean; error?: string }> {
  const enabled = await enabledProviders();
  if (enabled && !enabled[provider]) return { ok: false, error: 'PROVIDER_DISABLED' };
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined },
  });
  if (error || !data?.url) return { ok: false, error: error?.message ?? 'OAUTH_UNAVAILABLE' };
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    // Sur Android, le retour peut passer par le lien profond (écran auth-callback) : la session suffit.
    const { data: s } = await supabase.auth.getSession();
    if (s.session) return { ok: true };
    return { ok: false, error: result.type === 'cancel' || result.type === 'dismiss' ? 'CANCELLED' : 'OAUTH_FAILED' };
  }
  const { queryParams } = Linking.parse(result.url);
  const errDesc = queryParams?.error_description ?? queryParams?.error;
  if (errDesc) return { ok: false, error: String(errDesc) };
  const code = queryParams?.code;
  if (!code) return { ok: false, error: 'OAUTH_FAILED' };
  return exchangeCode(String(code));
}
