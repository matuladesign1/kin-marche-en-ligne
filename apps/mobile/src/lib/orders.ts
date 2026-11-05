import type { Order, OrderStatus } from './types';

/** Code promo choisi ailleurs (Roue de la chance) à appliquer à la prochaine validation de commande. */
export const NEXT_COUPON_KEY = 'km.coupon.next';

/** Rubriques de « Mes commandes » (même découpage dans le compte et la liste des commandes). */
export type OrderTab = 'all' | 'toPay' | 'toShip' | 'toReceive' | 'refund' | 'toReview' | 'done';
export const ORDER_TABS: OrderTab[] = ['all', 'toPay', 'toShip', 'toReceive', 'refund', 'toReview', 'done'];

export const TO_SHIP: OrderStatus[] = ['payment_confirmed', 'sent_to_store', 'preparing', 'verified', 'packed', 'ready'];
export const TO_RECEIVE: OrderStatus[] = [
  'driver_assigned', 'driver_to_store', 'picked_up', 'in_delivery', 'driver_near', 'driver_arrived', 'recipient_check', 'delivered',
];

export function isOrderTab(v: unknown): v is OrderTab {
  return typeof v === 'string' && (ORDER_TABS as string[]).includes(v);
}

export function inOrderTab(o: Order, tab: OrderTab, toReview: Set<string>): boolean {
  switch (tab) {
    case 'all': return true;
    case 'toPay': return o.status === 'received' && ['pending', 'processing', 'failed'].includes(o.payment_status);
    case 'toShip': return TO_SHIP.includes(o.status);
    case 'toReceive': return TO_RECEIVE.includes(o.status);
    case 'refund': return o.status === 'refunded' || ['refunded', 'partially_refunded'].includes(o.payment_status);
    case 'toReview': return toReview.has(o.id);
    case 'done': return ['completed', 'cancelled', 'failed'].includes(o.status);
  }
}

export function countOrderTabs(orders: Order[], toReview: Set<string>): Record<OrderTab, number> {
  const c = {} as Record<OrderTab, number>;
  for (const tab of ORDER_TABS) c[tab] = orders.filter((o) => inOrderTab(o, tab, toReview)).length;
  return c;
}
