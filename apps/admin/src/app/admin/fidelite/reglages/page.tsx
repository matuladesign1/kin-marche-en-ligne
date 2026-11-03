import { saveSettingsAction } from '@/components/loyalty/actions';
import { LoyaltyHeader } from '@/components/loyalty/LoyaltyAdmin';
import { Flash } from '@/components/Shell';
import { requireSuper } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase-server';

// Règles du programme Kin Marché Fidélité dans l'application (administrateur général).
export default async function ReglagesFidelite({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireSuper();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data }, { data: rate }] = await Promise.all([
    sb.from('app_settings').select('value').eq('key', 'loyalty').maybeSingle(),
    sb.from('exchange_rates').select('rate_per_usd').eq('currency', 'CDF').maybeSingle(),
  ]);
  const s = (data?.value ?? {}) as Record<string, any>;
  const bonus = (k: string) => Math.round(Number(s.tier_bonus?.[k] ?? 0) * 1000) / 10;
  const cdf = Number(rate?.rate_per_usd ?? 0);
  const minUsd = cdf ? Number(s.enroll_min_cdf ?? 16000) / cdf : null;

  return (
    <>
      <LoyaltyHeader base="/admin/fidelite" current="settings" isSuper />
      <Flash ok={sp.ok} err={sp.err} />
      <form action={saveSettingsAction} className="card stack">
        <h2 style={{ margin: 0 }}>Carte et points</h2>
        <div className="cols">
          <label>Achat payé pour obtenir la carte Argent (FC)
            <input name="enroll_min_cdf" inputMode="numeric" defaultValue={s.enroll_min_cdf ?? 16000} required />
            {minUsd ? <span className="muted" style={{ fontSize: 12 }}>≈ {minUsd.toFixed(2)} $ au taux actuel</span> : null}</label>
          <label>Points gagnés par dollar payé
            <input name="earn_per_usd" inputMode="decimal" defaultValue={s.earn_per_usd ?? 1} required /></label>
          <label>Valeur d&apos;un point ($)
            <input name="point_value_usd" inputMode="decimal" defaultValue={s.point_value_usd ?? 0.01} required /></label>
          <label>Part d&apos;une commande payable en points (%)
            <input name="max_redeem_pct" inputMode="numeric" defaultValue={Math.round(Number(s.max_redeem_ratio ?? 0.5) * 100)} required /></label>
          <label>Validité des points gagnés (jours)
            <input name="expiry_days" inputMode="numeric" defaultValue={s.expiry_days ?? 365} required /></label>
        </div>
        <h2 style={{ margin: '8px 0 0' }}>Bonus par niveau</h2>
        <div className="cols">
          <label>Argent (%)<input name="bonus_silver" inputMode="decimal" defaultValue={bonus('silver')} required /></label>
          <label>Gold (%)<input name="bonus_gold" inputMode="decimal" defaultValue={bonus('gold')} required /></label>
          <label>Platinum (%)<input name="bonus_platinum" inputMode="decimal" defaultValue={bonus('platinum')} required /></label>
        </div>
        <h2 style={{ margin: '8px 0 0' }}>Programme Kin Marché Fidélité</h2>
        <div className="cols">
          <label>Nom<input name="program_name" defaultValue={s.program?.name ?? 'Kin Marché Fidélité'} required /></label>
          <label>Lien de l&apos;espace fidélité<input name="program_url" type="url" defaultValue={s.program?.url ?? 'https://loyalty.kinmarche.com/login'} required /></label>
          <label>Téléphone du service<input name="program_phone" defaultValue={s.program?.phone ?? ''} /></label>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" name="link_review" defaultChecked={s.link_review !== false} />
          Bloquer les points des cartes en magasin reliées automatiquement jusqu&apos;à leur vérification (recommandé)
        </label>
        <div className="row"><button type="submit">Enregistrer</button></div>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>
        Le passage en Gold ou Platinum reste une décision de l&apos;administration (fiche de la carte). Les changements de règles
        s&apos;appliquent aux prochaines commandes payées et sont inscrits au journal d&apos;audit.
      </p>
    </>
  );
}
