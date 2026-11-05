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
    <div className="auth">
      <section className="auth-brand" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-square.png" alt="" width={88} height={88} />
        <h2>Kin Marché en ligne</h2>
        <p>Espace de pilotage des supermarchés, des livraisons et du service client.</p>
        <ul>
          <li>Tableau de bord en temps réel des ventes confirmées</li>
          <li>Supermarchés, livreurs et agents par région</li>
          <li>Messagerie certifiée avec les clients</li>
        </ul>
      </section>
      <section className="auth-form">
        <div className="login card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-wide.png" alt="Kin Marché" />
          <h1>Connexion</h1>
          <p className="muted" style={{ marginTop: 0 }}>Direction, agents et directeurs de supermarché.</p>
          {erreur ? <div className="notice err">Adresse e-mail ou mot de passe incorrect.</div> : null}
          <form action={signIn} className="stack">
            <label>Adresse e-mail<input name="email" type="email" required autoComplete="email" /></label>
            <label>Mot de passe<input name="password" type="password" required autoComplete="current-password" /></label>
            <button type="submit">Se connecter</button>
          </form>
          <p className="muted" style={{ fontSize: 12 }}>Les clients et les livreurs utilisent l&apos;application mobile Kin Marché.</p>
        </div>
        <footer className="auth-foot">Tous droits réservés Kin Marché © 2026 · Développé par <b>Matula Design</b></footer>
      </section>
    </div>
  );
}
