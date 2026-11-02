import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { BrandLogo } from '@/components/BrandHeader';
import { SocialLogin } from '@/components/SocialLogin';
import { Button, Input, Notice, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/providers/SettingsProvider';

const PHONE_RE = /^\+?243\d{9}$/;

export default function SignUp() {
  const { t, language } = useSettings();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(null);
    const phone = form.phone.replace(/[\s-]/g, '');
    if (!form.fullName.trim() || !form.email.trim()) return setError(t('common.required'));
    if (phone && !PHONE_RE.test(phone)) return setError(t('auth.phone'));
    if (form.password.length < 8) return setError(t('auth.passwordRule'));
    setLoading(true);
    // Le rôle n'est jamais envoyé : tout nouveau compte est « client » côté serveur.
    const { data, error: e } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: { data: { full_name: form.fullName.trim(), phone: phone || null, language } },
    });
    setLoading(false);
    if (e) return setError(errorMessage(e, t));
    if (data.session) router.replace('/');
    else setDone(true);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <BrandLogo height={56} />
        <T size="xl" weight="700" style={{ textAlign: 'center' }}>{t('auth.signUp')}</T>
        {error ? <Notice tone="danger" text={error} /> : null}
        {done ? <Notice tone="success" text={t('auth.checkEmail')} /> : null}
        <Input label={t('auth.fullName')} value={form.fullName} onChangeText={set('fullName')} autoComplete="name" />
        <Input label={t('auth.phone')} value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+243 8x xxx xxxx" />
        <Input label={t('auth.email')} value={form.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Input label={`${t('auth.password')} — ${t('auth.passwordRule')}`} value={form.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" />
        <Button title={t('auth.signUp')} onPress={submit} loading={loading} />
        <SocialLogin />
        <Button title={t('auth.haveAccount') + ' ' + t('auth.signIn')} variant="ghost" onPress={() => router.replace('/(auth)/sign-in')} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
