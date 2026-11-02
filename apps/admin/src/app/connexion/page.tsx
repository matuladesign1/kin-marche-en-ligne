import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

async function signIn(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: String(formData.get('password') ?? ''),
  });
  if (error) redirect('/connexion?erreur=1');
  redirect('/');
}

export default async function Connexion({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  return (
    <div className="login card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-wide.png" alt="Kin Marché" />
      <h1>Administration</h1>
      {erreur ? <div className="notice err">Adresse e-mail ou mot de passe incorrect.</div> : null}
      <form action={signIn} className="stack">
        <label>Adresse e-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Mot de passe<input name="password" type="password" required autoComplete="current-password" /></label>
        <button type="submit">Se connecter</button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Réservé aux directeurs de supermarché et à l&apos;administration Kin Marché.</p>
    </div>
  );
}
