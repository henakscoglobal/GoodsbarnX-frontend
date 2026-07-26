// ==========================================
// ShelfMatch MVP - Products Service v1.0
// ==========================================

// SheetDB API
const PRODUCT_API = "https://sheetdb.io/api/v1/r8sckg9grdjob";

// Global product array
let products = [];

// Load products
async function loadProducts() {

    try {

        console.log("Loading products...");

        const response = await fetch(PRODUCT_API);

        if (!response.ok) {
            throw new Error("Unable to load products");
        }

        const data = await response.json();

        products = data;

        // Save offline
        localStorage.setItem(
            "shelfmatch_products",
            JSON.stringify(products)
        );

        console.log(`✅ ${products.length} products loaded`);

        return products;

    } catch (error) {

        console.error(error);

        // Offline mode
        const cached = localStorage.getItem("shelfmatch_products");

        if (cached) {

            products = JSON.parse(cached);

            console.log(`📦 Loaded ${products.length} cached products`);

            return products;

        }

        console.log("No cached products found.");

        return [];

    }

}

// Get all products
function getProducts() {
    return products;
}

// Refresh products
async function refreshProducts() {
    return await loadProducts();
}

// Start loading immediately
loadProducts();
