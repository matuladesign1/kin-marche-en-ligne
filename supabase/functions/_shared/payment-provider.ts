// Interface commune aux prestataires de paiement agréés (Mobile Money, cartes).
// Aucun prestataire n'est branché tant que ses identifiants contractuels
// n'ont pas été fournis : on n'invente ni ne simule aucun paiement.

export type PaymentMethod =
  | 'mpesa' | 'orange_money' | 'airtel_money' | 'afrimoney' | 'visa' | 'mastercard' | 'bank_transfer' | 'other';

export interface InitiateInput {
  paymentId: string;          // notre identifiant (référence marchand)
  orderNumber: string;
  amount: number;
  currency: 'USD' | 'CDF' | 'EUR';
  method: PaymentMethod;
  payerPhone?: string;        // jamais de PIN : le client valide sur son téléphone
  callbackUrl: string;        // URL du webhook payments-webhook
}

export interface InitiateResult {
  providerReference: string;
  status: 'processing' | 'pending';
  redirectUrl?: string;       // page de paiement carte hébergée par le prestataire
}

export interface WebhookResult {
  paymentId: string;
  providerReference: string;
  status: 'succeeded' | 'failed';
  amount: number;
  currency: 'USD' | 'CDF' | 'EUR';
  reason?: string;
  raw: unknown;
}

export interface PaymentProvider {
  name: string;
  supports(method: PaymentMethod): boolean;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Doit vérifier la signature du prestataire et lever une erreur sinon. */
  parseWebhook(req: Request, rawBody: string): Promise<WebhookResult>;
}

/**
 * Retourne le prestataire configuré (variable d'environnement PAYMENT_PROVIDER),
 * ou null si aucun n'est intégré. Ajouter ici l'adaptateur du prestataire retenu
 * (agrégateur Mobile Money RDC, passerelle carte…) une fois le contrat signé.
 */
export function getProvider(): PaymentProvider | null {
  const name = Deno.env.get('PAYMENT_PROVIDER');
  switch (name) {
    // case 'mon-prestataire': return new MonPrestataireAdapter(Deno.env.get('MON_PRESTATAIRE_API_KEY')!, ...);
    default:
      return null;
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
