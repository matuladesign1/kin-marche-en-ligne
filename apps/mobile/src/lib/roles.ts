import type { AppRole } from './types';

export function homeForRole(role: AppRole | null | undefined): '/(customer)' | '/store-admin' | '/driver' | '/admin' | '/pastry' {
  switch (role) {
    case 'store_admin': return '/store-admin';
    case 'driver': return '/driver';
    case 'pastry_chef': return '/pastry';
    case 'super_admin':
    case 'agent': return '/admin';
    default: return '/(customer)';
  }
}
