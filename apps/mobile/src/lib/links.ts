import { router } from 'expo-router';
import { Linking } from 'react-native';

/** Types de lien d'une bannière ou d'une promotion (mêmes valeurs que dans l'administration). */
export type AppLinkType = 'product' | 'category' | 'promotion' | 'url';

/** Le lien mène-t-il quelque part ? */
export function hasAppLink(type: unknown, value: unknown): boolean {
  if (type === 'promotion') return true;
  if (typeof value !== 'string' || !value) return false;
  if (type === 'url') return /^https:\/\//.test(value);
  return type === 'product' || type === 'category';
}

/** Ouvre l'écran d'un lien de bannière ou de promotion : produit, catégorie, promotions ou site web. */
export function openAppLink(type: unknown, value: unknown): boolean {
  if (!hasAppLink(type, value)) return false;
  switch (type) {
    case 'product': router.push(`/product/${value as string}`); break;
    case 'category': router.push(`/category/${value as string}`); break;
    case 'promotion': router.push('/search?promo=1'); break;
    case 'url': Linking.openURL(value as string).catch(() => undefined); break;
    default: return false;
  }
  return true;
}
