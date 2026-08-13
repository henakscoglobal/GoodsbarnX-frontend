// GoodsbarnX Configuration
const CONFIG = {
  SUPABASE_URL: "https://zcxecnxirfdfvywnvcjp.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGVjbnhpcmZkZnZ5d252Y2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDIyMTMsImV4cCI6MjEwMDY3ODIxM30.ooKObFp6Mj_gKlVLZXnVyeDAdfdjzDJwqx2buimmBtI",
  BACKEND_URL: "https://shelfmatch-backend-5mjl.vercel.app/api",
  SECRET: "shelfmatch-2026-secure",
  PAYSTACK_PUBLIC_KEY: "pk_test_xxxxxxxxxxxxx",
};

const LOCATIONS = [
  "Onitsha", "Nnewi", "Awka", "Asaba", "Enugu",
  "Owerri", "Abakiliki", "Agbor", "Warri", "Aba"
];

const CATEGORIES = [
  "Auto Parts", "Motorcycle", "Tyres", "Batteries", "Lubricants",
  "Electronics", "Pharma", "Textiles", "Building Materials", "General Goods",
  "Raw Materials", "Food & Beverages", "Agriculture", "Cosmetics", "Baby Products",
  "Frozen Foods", "Poultry", "Computers", "Electrical", "Plumbing",
  "Furniture", "Home Appliances", "Packaging", "Logistics"
];

const CATEGORY_ICONS = {
  "Auto Parts": "⚙️", "Motorcycle": "🏍", "Tyres": "🚗", "Batteries": "🔋",
  "Lubricants": "🛢", "Electronics": "📱", "Pharma": "💊", "Textiles": "🧵",
  "Building Materials": "🧱", "General Goods": "🛒", "Raw Materials": "🏭",
  "Food & Beverages": "🥫", "Agriculture": "🌾", "Cosmetics": "🧴",
  "Baby Products": "👶", "Frozen Foods": "🐟", "Poultry": "🐓",
  "Computers": "💻", "Electrical": "🔌", "Plumbing": "🚿",
  "Furniture": "🪑", "Home Appliances": "🏠", "Packaging": "📦",
  "Logistics": "🚚"
};

// Initialize Supabase
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Global state
const state = {
  currentUser: null,
  activeCategory: "All",
  allDistributors: [],
  allBuyers: [],
  userFavourites: new Set(),
  cart: JSON.parse(localStorage.getItem("goodsbarnx_cart") || "[]"),
  currentScreen: "market",
  selectedContact: { id: null, name: "", type: "" },
  selectedTier: "",
  productImageFile: null,
};
