import { LoyaltyCardDetail } from '@/components/loyalty/LoyaltyAdmin';
import { requireSuper } from '@/lib/auth';

export default async function FideliteCarte({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSuper();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <LoyaltyCardDetail base="/admin/fidelite" id={id} sp={sp} />;
}
