import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'facebook';

/**
 * Connexion Google / Facebook via Supabase (PKCE). Le fournisseur doit être activé
 * dans Supabase → Authentication → Providers, avec l'URL de retour « kinmarche://auth-callback ».
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<{ ok: boolean; error?: string }> {
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined },
  });
  if (error || !data?.url) return { ok: false, error: error?.message ?? 'OAUTH_UNAVAILABLE' };
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return { ok: false, error: result.type === 'cancel' || result.type === 'dismiss' ? 'CANCELLED' : 'OAUTH_FAILED' };
  const { queryParams } = Linking.parse(result.url);
  const errDesc = queryParams?.error_description ?? queryParams?.error;
  if (errDesc) return { ok: false, error: String(errDesc) };
  const code = queryParams?.code;
  if (!code) return { ok: false, error: 'OAUTH_FAILED' };
  const { error: exErr } = await supabase.auth.exchangeCodeForSession(String(code));
  return exErr ? { ok: false, error: exErr.message } : { ok: true };
}
