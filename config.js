// config.js — GoodsbarnX
// Single source of truth for Supabase client + app-wide constants.
// This file has NO dependencies on other js/ files. Load it first.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- Supabase project config ---
const SUPABASE_URL = 'https://zcxecnxirfdfvywnvcjp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGVjbnhpcmZkZnZ5d252Y2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDIyMTMsImV4cCI6MjEwMDY3ODIxM30.ooKObFp6Mj_gKlVLZXnVyeDAdfdjzDJwqx2buimmBtI'; // Supabase dashboard > Settings > API > anon public key

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- App-wide constants ---
export const CITIES = [
  'Onitsha', 'Nnewi', 'Awka', 'Asaba', 'Enugu',
  'Owerri', 'Abakiliki', 'Agbor', 'Warri', 'Aba'
];

export const STORAGE_BUCKET = 'product-images';
export const OFFLINE_QUEUE_KEY = 'shelfmatch_queue';

export const BACKEND_URL = 'https://shelfmatch-backend-5mjl.vercel.app';

// --- Simple connection check, used only for Step 1 testing ---
export async function testConnection() {
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    if (error) throw error;
    return { ok: true, message: 'Supabase connected ✅' };
  } catch (err) {
    return { ok: false, message: `Connection failed: ${err.message}` };
  }
}

