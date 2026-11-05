import { LoyaltyCards, LoyaltyHeader } from '@/components/loyalty/LoyaltyAdmin';
import { requireSuper } from '@/lib/auth';

export default async function Fidelite({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuper();
  const sp = await searchParams;
  return (
    <>
      <LoyaltyHeader base="/admin/fidelite" current="cards" isSuper />
      <LoyaltyCards base="/admin/fidelite" sp={sp} isSuper />
    </>
  );
}
