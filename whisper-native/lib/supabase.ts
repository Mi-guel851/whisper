import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

const supabaseUrl = 'https://mqntxusokchjcwjgwfdu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xbnR4dXNva2NoamN3amd3ZmR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjY2MjMsImV4cCI6MjA5ODI0MjYyM30.qlk8TO7X1zj6X_qyT_vDUoCyvhRrgQ9kOXGve_m6v2E'

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    }
  }
)