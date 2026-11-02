import type { CurrentUser } from '@/lib/auth';
import { signOutAction } from './actions';
import { Icon } from './icons';
import { NavLinks, type NavGroup } from './NavLinks';

function initials(name: string | null, email: string | null) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Mise en page : barre latérale sombre (profil, recherche, menu) + barre supérieure. */
export function Shell({ user, groups, roleLabel, subtitle, searchAction, children }: {
  user: CurrentUser; groups: NavGroup[]; roleLabel: string; subtitle?: string; searchAction?: string; children: React.ReactNode;
}) {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' });
  return (
    <div className="app">
      <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-square.png" alt="" width={40} height={40} />
          <div>
            <div className="brand-name">Kin Marché</div>
            <div className="brand-sub">Administration</div>
          </div>
        </div>
        <div className="profile">
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="avatar" src={user.avatar_url} alt="" />
          ) : (
            <div className="avatar">{initials(user.full_name, user.email)}</div>
          )}
          <div className="profile-name">{user.full_name ?? user.email}</div>
          <div className="profile-role">{roleLabel}</div>
          {subtitle ? <div className="profile-scope"><Icon name="pin" size={13} /> {subtitle}</div> : null}
        </div>
        {searchAction ? (
          <form action={searchAction} className="side-search" role="search">
            <Icon name="search" size={16} />
            <input name="q" placeholder="Rechercher…" aria-label="Rechercher" />
          </form>
        ) : null}
        <NavLinks groups={groups} />
        <div className="side-foot">
          <form action={signOutAction}><button className="logout"><Icon name="logout" size={16} /> Se déconnecter</button></form>
        </div>
      </aside>
      <label htmlFor="nav-toggle" className="scrim" aria-hidden="true" />
      <div className="content">
        <header className="topbar">
          <label htmlFor="nav-toggle" className="menu-btn" aria-label="Menu"><Icon name="menu" size={22} /></label>
          <div className="topbar-title">Kin Marché <span>· en ligne</span></div>
          <div className="topbar-right">
            <span className="topbar-date"><Icon name="calendar" size={15} /> {today}</span>
            <span className="topbar-user">{initials(user.full_name, user.email)}</span>
          </div>
        </header>
        <main className="main">{children}</main>
        <footer className="page-foot">
          <span>Tous droits réservés Kin Marché © 2026</span>
          <span>Développé par <b>Matula Design</b></span>
        </footer>
      </div>
    </div>
  );
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <div className="notice err">{err}</div>;
  if (ok) return <div className="notice ok">{ok}</div>;
  return null;
}
