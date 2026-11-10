import { createClient } from
  'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL =
  'https://mlaoeharqbxepezrtran.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_KaAWRoIp1IpKhy3WjNeMQQ_Lqqs9z0b';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
);