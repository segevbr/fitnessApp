import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Supabase env vars not set. Copy .env.example → .env.local and add your project URL and anon key.',
  )
}

export const supabase = createClient(url, key)
