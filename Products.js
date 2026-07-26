// ===============================
// ShelfMatch Product Service
// ===============================

// Replace with your own SheetDB API
const PRODUCT_API = "https://sheetdb.io/api/v1/r8sckg9grdjob";

let allProducts = [];

/**
 * Load products from SheetDB
 */
async function loadProducts() {

    try {

        const response = await fetch(PRODUCT_API);

        const data = await response.json();

        allProducts = data;

        // Save offline copy
        localStorage.setItem(
            "shelfmatch_products",
            JSON.stringify(data)
        );

        console.log(
            "Products loaded:",
            allProducts.length
        );

    }

    catch(error){

        console.log(
            "Offline mode..."
        );

        allProducts = JSON.parse(
            localStorage.getItem(
                "shelfmatch_products"
            ) || "[]"
        );

    }

}
