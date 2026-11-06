import type { Metadata } from 'next';
import { headers } from 'next/headers';

// Page publique « Voir l'offre » des e-mails de promotion : ouvre l'application Kin Marché sur la bonne page
// (produit, catégorie ou promotions) ; si l'application n'est pas installée, propose de la télécharger.

export const metadata: Metadata = { title: 'Kin Marché — Voir l’offre', robots: { index: false } };

const PACKAGE = 'cd.kinmarche.enligne';
const DOWNLOAD = 'https://github.com/matuladesign1/kin-marche-en-ligne/releases';
const SAFE = /^[A-Za-z0-9-]{1,64}$/;

export default async function Ouvrir({ searchParams }: { searchParams: Promise<{ t?: string; v?: string }> }) {
  const { t, v } = await searchParams;
  const value = v && SAFE.test(v) ? v : null;
  const path = t === 'product' && value ? `product/${value}`
    : t === 'category' && value ? `category/${value}`
    : t === 'promotion' ? 'search?promo=1' : '';
  const deep = `kinmarche://${path}`;
  // Android : ouvre l'application si elle est installée, sinon la page de téléchargement.
  const intent = `intent://${path}#Intent;scheme=kinmarche;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(DOWNLOAD)};end`;
  const android = /android/i.test((await headers()).get('user-agent') ?? '');
  const href = android ? intent : deep;
  const script = `setTimeout(function(){location.href=${JSON.stringify(href)};},300);`;

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#F5F5F3' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', maxWidth: 400, width: '100%', textAlign: 'center', boxShadow: '0 6px 24px rgba(0,0,0,.08)', display: 'grid', gap: 14 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-wide.png" alt="Kin Marché" style={{ width: 200, margin: '0 auto' }} />
        <h1 style={{ fontSize: 20, margin: 0, color: '#1B1D22' }}>Ouverture de l’offre dans l’application…</h1>
        <p style={{ margin: 0, color: '#5B6170' }}>Si rien ne se passe, touchez le bouton ci-dessous.</p>
        <a href={href} className="btn" style={{ background: '#E60024', fontSize: 16, padding: '13px 18px' }}>Ouvrir Kin Marché</a>
        <a href={DOWNLOAD} style={{ color: '#5B6170', fontSize: 14 }}>Pas encore l’application ? Téléchargez-la</a>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </main>
  );
}
