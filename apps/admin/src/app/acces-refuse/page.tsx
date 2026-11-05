import { signOutAction } from '@/components/actions';

export default function AccesRefuse() {
  return (
    <div className="login card">
      <h1>Accès refusé</h1>
      <p>Ce compte n&apos;a pas les droits d&apos;administration. Les clients et livreurs utilisent l&apos;application mobile.</p>
      <form action={signOutAction}><button className="secondary">Se déconnecter</button></form>
    </div>
  );
}
