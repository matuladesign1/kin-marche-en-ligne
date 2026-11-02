import type { TranslationKey } from './fr';

// Lingala — traduction partielle À FAIRE VALIDER par un locuteur natif
// avant publication. Les clés absentes s'affichent en français.
const ln: Partial<Record<TranslationKey, string>> = {
  'tab.home': 'Ebandeli', 'tab.cart': 'Kitunga', 'tab.orders': 'Basombi', 'tab.account': 'Konte',
  'common.loading': 'Ezali kozwama…', 'common.cancel': 'Kotika', 'common.yes': 'Iyo', 'common.no': 'Te',
  'auth.signIn': 'Kokota', 'auth.signOut': 'Kobima',
  'home.searchPlaceholder': 'Luka eloko…',
  'product.addToCart': 'Tia na kitunga', 'product.outOfStock': 'Esili',
  'cart.title': 'Kitunga na ngai', 'cart.empty': 'Kitunga ezali pamba.',
  'orders.title': 'Basombi na ngai',
};
export default ln;
