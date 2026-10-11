import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const SUPABASE_URL = 'https://kuniwiidqjtcqucaohuw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_cQS8mQlora4dAxAaA2Vqjw_I-ePyQ1x';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
