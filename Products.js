// =====================================
// ShelfMatch MVP - Product Loader
// =====================================

const PRODUCT_API = "https://sheetdb.io/api/v1/r8sckg9grdjob";

let products = [];

async function loadProducts() {

    try {

        const response = await fetch(PRODUCT_API);

        if (!response.ok) {
            throw new Error("Unable to load products");
        }

        products = await response.json();

        localStorage.setItem(
            "shelfmatch_products",
            JSON.stringify(products)
        );

        console.log("✅ Products Loaded");
        console.table(products);

    } catch (error) {

        console.warn("Offline mode");

        products = JSON.parse(
            localStorage.getItem("shelfmatch_products") || "[]"
        );

        console.table(products);

    }

}

loadProducts();
