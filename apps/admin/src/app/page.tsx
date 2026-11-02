import { redirect } from 'next/navigation';
import { currentUser, homeFor } from '@/lib/auth';

export default async function Home() {
  const u = await currentUser();
  redirect(u ? homeFor(u.role) : '/connexion');
}
