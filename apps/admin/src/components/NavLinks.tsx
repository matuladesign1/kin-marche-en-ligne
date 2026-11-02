'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

export interface NavGroup { title: string; links: { href: string; label: string; icon: string; badge?: number }[] }

/** Menu latéral : met en évidence la page en cours. */
export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const active = (href: string) => (href === '/admin' || href === '/magasin' ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="nav" aria-label="Navigation principale">
      {groups.filter((g) => g.links.length).map((g) => (
        <div key={g.title} className="nav-group">
          <div className="nav-title">{g.title}</div>
          {g.links.map((l) => (
            <Link key={l.href} href={l.href} className={`nav-link${active(l.href) ? ' active' : ''}`}>
              <Icon name={l.icon} />
              <span>{l.label}</span>
              {l.badge ? <span className="nav-badge">{l.badge > 99 ? '99+' : l.badge}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
