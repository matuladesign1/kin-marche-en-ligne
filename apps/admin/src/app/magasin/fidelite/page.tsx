import { LoyaltyCards, LoyaltyHeader } from '@/components/loyalty/LoyaltyAdmin';
import { requireRole } from '@/lib/auth';

// Les administrateurs de supermarché gèrent toutes les cartes : niveau Gold ou Platinum,
// suspension, ajustement de points et vérification des cartes reliées.
export default async function MagasinFidelite({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('store_admin');
  const sp = await searchParams;
  return (
    <>
      <LoyaltyHeader base="/magasin/fidelite" current="cards" isSuper={false} />
      <LoyaltyCards base="/magasin/fidelite" sp={sp} isSuper={false} />
    </>
  );
}
