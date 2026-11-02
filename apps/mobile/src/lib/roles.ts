import type { AppRole } from './types';

export function homeForRole(role: AppRole | null | undefined): '/(customer)' | '/store-admin' | '/driver' | '/admin' {
  switch (role) {
    case 'store_admin': return '/store-admin';
    case 'driver': return '/driver';
    case 'super_admin': return '/admin';
    default: return '/(customer)';
  }
}
