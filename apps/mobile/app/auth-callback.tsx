import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Loading } from '@/components/ui';
import { exchangeCode } from '@/lib/oauth';

// Retour de connexion Google / Facebook, de confirmation d'e-mail ou de changement d'e-mail :
// le code reçu est échangé contre la session (une seule fois), puis retour à l'accueil.
export default function AuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [done, setDone] = useState(!code);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    exchangeCode(String(code)).finally(() => { if (alive) setDone(true); });
    return () => { alive = false; };
  }, [code]);

  if (!done) return <Loading />;
  return <Redirect href="/" />;
}
