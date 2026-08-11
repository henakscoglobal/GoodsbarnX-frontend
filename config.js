// GoodsbarnX – Configuration & Supabase Initialization
const SUPABASE_URL = "https://zcxecnxirfdfvywnvcjp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGVjbnhpcmZkZnZ5d252Y2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDIyMTMsImV4cCI6MjEwMDY3ODIxM30.ooKObFp6Mj_gKlVLZXnVyeDAdfdjzDJwqx2buimmBtI";
const BACKEND = "/api";  // Vercel serverless functions
const SECRET = "shelfmatch-2026-secure";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
