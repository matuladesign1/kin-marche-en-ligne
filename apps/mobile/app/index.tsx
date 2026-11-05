import { Redirect } from 'expo-router';
import { Loading } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { homeForRole } from '@/lib/roles';

// Redirection automatique vers l'espace correspondant au rôle (vérifié côté serveur par la RLS).
export default function Index() {
  const { loading, profile } = useAuth();
  if (loading) return <Loading />;
  return <Redirect href={homeForRole(profile?.role)} />;
}
