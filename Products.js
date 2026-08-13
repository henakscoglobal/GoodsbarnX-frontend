// GoodsbarnX – Product Management Module

let productImageFile = null;

document.addEventListener("screenChanged", (e) => {
  if (e.detail.screen === "products") loadProductsManagement();
});

document.addEventListener("userLoaded", () => {
  toggleProductsNav();
});

async function loadProductsManagement() {
  if (!currentUser || currentUser.role !== "distributor") return;

  const { data: products, error } = await sb.from("products").select("*").eq("distributor_id", currentUser.id).order("created_at", { ascending: false });
  const list = document.getElementById("products-management-list");
  if (!list) return;

  if (error || !products || products.length === 0) {
    list.innerHTML = '<div class="loading-text">You haven\'t added any products yet. Tap "+ Add New Product" to begin.</div>';
    return;
  }

  list.innerHTML = products.map(p => `
    <div class="manifest" style="padding:12px;">
      <div class="manifest-top">
        <div>
          <div class="m-name">${p.name}</div>
          <div class="m-loc">SKU: ${p.sku || "—"} | Brand: ${p.brand || "—"}</div>
          <div class="m-loc">Price: ${p.price ? "₦" + p.price : "—"} | Stock: ${p.stock_quantity}</div>
        </div>
        <div class="stamp-badge" style="font-size:8px;">${p.category || "General"}</div>
      </div>
      ${p.product_image ? `<div style="width:60px; height:60px; border-radius:8px; background-image:url(${p.product_image}); background-size:cover; margin-bottom:8px;"></div>` : ""}
      <div style="text-align:right; margin-top:8px;">
        <button class="btn-inquire" style="margin-right:6px;" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn-inquire" style="background:var(--ink-2); color:var(--stamp); border:1px solid var(--stamp);" onclick="deleteProduct('${p.id}')">Delete</button>
      </div>
    </div>
  `).join("");
}

function toggleProductsNav() {
  const nav = document.getElementById("nav-products");
  if (nav) {
    nav.style.display = (currentUser && currentUser.role === "distributor") ? "flex" : "none";
  }
}

// ---------- Add Product Modal ----------
function openAddProductModal() {
  document.getElementById("prod-name").value = "";
  document.getElementById("prod-sku").value = "";
  document.getElementById("prod-brand").value = "";
  document.getElementById("prod-category").value = "";
  document.getElementById("prod-subcategory").value = "";
  document.getElementById("prod-unit").value = "";
  document.getElementById("prod-moq").value = 1;
  document.getElementById("prod-stock").value = 0;
  document.getElementById("prod-price").value = "";
  document.getElementById("prod-negotiable").value = "false";
  document.getElementById("prod-bulk-discount").value = "false";
  document.getElementById("prod-lead-time").value = "";
  document.getElementById("prod-trade-terms").value = "";
  document.getElementById("prod-delivery").value = "true";
  document.getElementById("prod-pickup").value = "false";
  document.getElementById("prod-desc").value = "";
  document.getElementById("add-product-status").innerText = "";
  document.getElementById("add-product-modal").classList.add("active");

  const submitBtn = document.querySelector("#add-product-modal .submit-btn");
  if (submitBtn) submitBtn.onclick = addProduct;

  // Reset image
  productImageFile = null;
  const imageInput = document.getElementById("prod-image-input");
  if (imageInput) imageInput.value = "";
  const preview = document.getElementById("prod-image-preview");
  if (preview) preview.classList.remove("has-image");
}

function closeAddProductModal() {
  document.getElementById("add-product-modal").classList.remove("active");
}

function previewProductImage() {
  const file = document.getElementById("prod-image-input").files[0];
  if (!file) return;
  productImageFile = file;
  const reader = new FileReader();
  reader.onload = function(e) {
    const preview = document.getElementById("prod-image-preview");
    preview.style.backgroundImage = `url(${e.target.result})`;
    preview.classList.add("has-image");
  };
  reader.readAsDataURL(file);
}

async function uploadProductImage() {
  if (!productImageFile) return null;
  const fileName = `${currentUser.id}_${Date.now()}_${productImageFile.name}`;
  const { data, error } = await sb.storage.from("product-images").upload(fileName, productImageFile, {
    cacheControl: "3600",
    upsert: false
  });
  if (error) {
    console.error("Image upload error:", error);
    return null;
  }
  const { data: publicURL } = sb.storage.from("product-images").getPublicUrl(fileName);
  return publicURL?.publicUrl || null;
}

async function addProduct() {
  const name = document.getElementById("prod-name").value.trim();
  if (!name) {
    document.getElementById("add-product-status").innerText = "Product name is required.";
    return;
  }

  document.getElementById("add-product-status").innerText = "Uploading...";
  const imageUrl = await uploadProductImage();
  if (productImageFile && !imageUrl) {
    document.getElementById("add-product-status").innerText = "Image upload failed. Try again.";
    return;
  }

  const productData = {
    distributor_id: currentUser.id,
    name: name,
    sku: document.getElementById("prod-sku").value,
    brand: document.getElementById("prod-brand").value,
    category: document.getElementById("prod-category").value,
    subcategory: document.getElementById("prod-subcategory").value,
    unit: document.getElementById("prod-unit").value,
    moq: parseInt(document.getElementById("prod-moq").value) || 1,
    stock_quantity: parseInt(document.getElementById("prod-stock").value) || 0,
    price: parseFloat(document.getElementById("prod-price").value) || null,
    negotiable: document.getElementById("prod-negotiable").value === "true",
    bulk_discount: document.getElementById("prod-bulk-discount").value === "true",
    lead_time: document.getElementById("prod-lead-time").value,
    trade_terms: document.getElementById("prod-trade-terms").value,
    delivery_available: document.getElementById("prod-delivery").value === "true",
    pickup_available: document.getElementById("prod-pickup").value === "true",
    description: document.getElementById("prod-desc").value,
    product_image: imageUrl,
    status: "active"
  };

  const { error } = await sb.from("products").insert(productData);
  if (error) {
    document.getElementById("add-product-status").innerText = "Error adding product. Please try again.";
  } else {
    document.getElementById("add-product-status").innerText = "Product added successfully!";
    closeAddProductModal();
    loadProductsManagement();
    // Reset image
    productImageFile = null;
    document.getElementById("prod-image-input").value = "";
    document.getElementById("prod-image-preview").classList.remove("has-image");
  }
}

async function editProduct(productId) {
  const { data: prod } = await sb.from("products").select("*").eq("id", productId).single();
  if (!prod) return;

  document.getElementById("prod-name").value = prod.name || "";
  document.getElementById("prod-sku").value = prod.sku || "";
  document.getElementById("prod-brand").value = prod.brand || "";
  document.getElementById("prod-category").value = prod.category || "";
  document.getElementById("prod-subcategory").value = prod.subcategory || "";
  document.getElementById("prod-unit").value = prod.unit || "";
  document.getElementById("prod-moq").value = prod.moq || 1;
  document.getElementById("prod-stock").value = prod.stock_quantity || 0;
  document.getElementById("prod-price").value = prod.price || "";
  document.getElementById("prod-negotiable").value = prod.negotiable ? "true" : "false";
  document.getElementById("prod-bulk-discount").value = prod.bulk_discount ? "true" : "false";
  document.getElementById("prod-lead-time").value = prod.lead_time || "";
  document.getElementById("prod-trade-terms").value = prod.trade_terms || "";
  document.getElementById("prod-delivery").value = prod.delivery_available ? "true" : "false";
  document.getElementById("prod-pickup").value = prod.pickup_available ? "true" : "false";
  document.getElementById("prod-desc").value = prod.description || "";
  document.getElementById("add-product-status").innerText = "";
  document.getElementById("add-product-modal").classList.add("active");

  const saveBtn = document.querySelector("#add-product-modal .submit-btn");
  saveBtn.onclick = async () => {
    const updatedData = {
      name: document.getElementById("prod-name").value,
      sku: document.getElementById("prod-sku").value,
      brand: document.getElementById("prod-brand").value,
      category: document.getElementById("prod-category").value,
      subcategory: document.getElementById("prod-subcategory").value,
      unit: document.getElementById("prod-unit").value,
      moq: parseInt(document.getElementById("prod-moq").value) || 1,
      stock_quantity: parseInt(document.getElementById("prod-stock").value) || 0,
      price: parseFloat(document.getElementById("prod-price").value) || null,
      negotiable: document.getElementById("prod-negotiable").value === "true",
      bulk_discount: document.getElementById("prod-bulk-discount").value === "true",
      lead_time: document.getElementById("prod-lead-time").value,
      trade_terms: document.getElementById("prod-trade-terms").value,
      delivery_available: document.getElementById("prod-delivery").value === "true",
      pickup_available: document.getElementById("prod-pickup").value === "true",
      description: document.getElementById("prod-desc").value,
      updated_at: new Date()
    };

    const { error } = await sb.from("products").update(updatedData).eq("id", productId);
    if (error) {
      document.getElementById("add-product-status").innerText = "Error updating product.";
    } else {
      closeAddProductModal();
      loadProductsManagement();
    }
  };
}

async function deleteProduct(productId) {
  if (!confirm("Delete this product?")) return;
  const { error } = await sb.from("products").delete().eq("id", productId);
  if (!error) loadProductsManagement();
}
