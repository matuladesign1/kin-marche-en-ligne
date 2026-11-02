import Link from 'next/link';
import type { CurrentUser } from '@/lib/auth';
import { signOutAction } from './actions';

export function Shell({ user, links, children }: { user: CurrentUser; links: { href: string; label: string }[]; children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="side" aria-label="Navigation">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-wide.png" alt="Kin Marché" />
        {links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        <div className="who">
          <div>{user.full_name ?? user.email}</div>
          <form action={signOutAction}><button className="secondary" style={{ marginTop: 8 }}>Se déconnecter</button></form>
          <div style={{ marginTop: 12 }}>Développé par MATULA DESIGN</div>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <div className="notice err">{err}</div>;
  if (ok) return <div className="notice ok">{ok}</div>;
  return null;
}
