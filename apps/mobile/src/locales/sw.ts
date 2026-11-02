import type { TranslationKey } from './fr';

// Kiswahili — traduction partielle à faire valider par un locuteur natif.
// Les clés absentes s'affichent en français.
const sw: Partial<Record<TranslationKey, string>> = {
  'app.tagline': 'Kwa bei ya Soko Kuu',
  'tab.home': 'Mwanzo', 'tab.categories': 'Aina', 'tab.cart': 'Kikapu', 'tab.orders': 'Maagizo', 'tab.account': 'Akaunti',
  'common.loading': 'Inapakia…', 'common.retry': 'Jaribu tena', 'common.save': 'Hifadhi', 'common.cancel': 'Ghairi',
  'common.confirm': 'Thibitisha', 'common.continue': 'Endelea', 'common.close': 'Funga', 'common.seeAll': 'Ona zote',
  'common.error': 'Hitilafu imetokea.', 'common.yes': 'Ndiyo', 'common.no': 'Hapana', 'common.call': 'Piga simu', 'common.send': 'Tuma',
  'auth.signIn': 'Ingia', 'auth.signUp': 'Fungua akaunti', 'auth.signOut': 'Toka', 'auth.email': 'Barua pepe', 'auth.password': 'Nenosiri',
  'auth.fullName': 'Jina kamili', 'auth.phone': 'Simu (+243…)', 'auth.forgot': 'Umesahau nenosiri?',
  'home.searchPlaceholder': 'Tafuta bidhaa, chapa…', 'home.deliverTo': 'Peleka kwa', 'home.chooseStore': 'Chagua duka',
  'home.bestSellers': 'Zinazouzwa zaidi', 'home.newArrivals': 'Bidhaa mpya', 'home.bestOffers': 'Ofa bora', 'home.featured': 'Tunapendekeza',
  'home.local': 'Bidhaa za nyumbani', 'home.favorites': 'Vipendwa', 'home.loyalty': 'Uaminifu', 'home.support': 'Msaada',
  'product.addToCart': 'Weka kikapuni', 'product.outOfStock': 'Imeisha', 'product.inStock': 'Ipo', 'product.added': 'Imewekwa kikapuni',
  'cart.title': 'Kikapu changu', 'cart.empty': 'Kikapu chako ni tupu.', 'cart.subtotal': 'Jumla ndogo', 'cart.checkout': 'Agiza',
  'checkout.address': 'Anwani ya kupeleka', 'checkout.deliveryFee': 'Gharama ya kupeleka', 'checkout.total': 'Jumla ya kulipa',
  'checkout.place': 'Thibitisha na ulipe', 'payment.title': 'Malipo', 'orders.title': 'Maagizo yangu', 'orders.otp': 'Nambari ya kupokea',
  'status.received': 'Agizo limepokelewa', 'status.payment_confirmed': 'Malipo yamethibitishwa', 'status.preparing': 'Inaandaliwa',
  'status.ready': 'Agizo liko tayari', 'status.in_delivery': 'Linapelekwa', 'status.driver_arrived': 'Msafirishaji amefika',
  'status.delivered': 'Limepokelewa', 'status.completed': 'Limekamilika', 'status.cancelled': 'Limeghairiwa',
  'account.title': 'Akaunti yangu', 'settings.language': 'Lugha', 'settings.currency': 'Sarafu', 'settings.theme': 'Mandhari',
  'notifications.title': 'Arifa', 'support.title': 'Msaada',
};
export default sw;
