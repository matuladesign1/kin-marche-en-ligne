import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export function useDriver() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['driver-me'],
    enabled: !!session,
    queryFn: async () => (await supabase.from('drivers').select('*').eq('id', session!.user.id).maybeSingle()).data as
      { id: string; driver_code: string; status: string; is_available: boolean; verified_at: string | null } | null,
  });
}
