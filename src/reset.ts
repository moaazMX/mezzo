import { supabase } from './lib/supabase';
import { RATE_SETTING_KEYS } from './lib/rateDiscount';

async function reset() {
  console.log('Resetting passwords...');
  const res1 = await supabase.from('settings').upsert({ key: RATE_SETTING_KEYS.loginPassword, value: 'moaazMXpl011#', updated_at: new Date().toISOString() }, { onConflict: 'key' });
  console.log('Login:', res1.error ? res1.error : 'OK');
  
  const res2 = await supabase.from('settings').upsert({ key: RATE_SETTING_KEYS.settingsPassword, value: 'moaazMXpl011#', updated_at: new Date().toISOString() }, { onConflict: 'key' });
  console.log('Settings:', res2.error ? res2.error : 'OK');
  
  process.exit(0);
}

reset();
