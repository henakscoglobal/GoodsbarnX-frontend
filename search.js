// GoodsbarnX MVP - Smart Search

function smartSearch(query) {

    query = query.trim().toLowerCase();

    if (!query) return products;

    return products.filter(product => {

        return (
            (product.PRODUCT_NAME || "").toLowerCase().includes(query) ||
            (product.BRAND || "").toLowerCase().includes(query) ||
            (product.CATEGORY || "").toLowerCase().includes(query) ||
            (product.DISTRIBUTOR || "").toLowerCase().includes(query) ||
            (product.LOCATION || "").toLowerCase().includes(query) ||
            (product.MARKET || "").toLowerCase().includes(query)
        );

    });

}
