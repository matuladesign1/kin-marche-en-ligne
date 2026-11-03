import { LoyaltyCardDetail } from '@/components/loyalty/LoyaltyAdmin';
import { requireRole } from '@/lib/auth';

export default async function MagasinFideliteCarte({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole('store_admin');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <LoyaltyCardDetail base="/magasin/fidelite" id={id} sp={sp} />;
}
