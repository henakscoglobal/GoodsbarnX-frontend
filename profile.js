// GoodsbarnX – Profile Module

document.addEventListener("screenChanged", (e) => {
  if (e.detail.screen === "profile") loadProfile();
});

async function loadProfile() {
  if (!currentUser) return;

  const statusEl = document.getElementById("profile-status");
  if (statusEl) statusEl.innerText = "";

  const isDistributor = currentUser.role === "distributor";

  // Show/hide fields
  const bizNameField = document.getElementById("profile-business-name-field");
  const categoryField = document.getElementById("profile-category-field");
  const nameField = document.getElementById("profile-name-field");
  const lookingForField = document.getElementById("profile-looking-for-field");

  if (bizNameField) bizNameField.style.display = isDistributor ? "block" : "none";
  if (categoryField) categoryField.style.display = isDistributor ? "block" : "none";
  if (nameField) nameField.style.display = isDistributor ? "none" : "block";
  if (lookingForField) lookingForField.style.display = isDistributor ? "none" : "block";

  if (isDistributor) {
    const { data: dist } = await sb.from("distributor_profiles").select("*").eq("id", currentUser.id).single();
    if (dist) {
      setFieldValue("profile-business-name", dist.business_name);
      setFieldValue("profile-category", dist.category);
      setFieldValue("profile-location", dist.location);
      setFieldValue("profile-market", dist.market);
      setFieldValue("profile-shop-address", dist.shop_address);
      setFieldValue("profile-description", dist.description);
    }
  } else {
    const { data: buyer } = await sb.from("buyer_profiles").select("*").eq("id", currentUser.id).single();
    if (buyer) {
      setFieldValue("profile-name", buyer.name);
      setFieldValue("profile-looking-for", buyer.looking_for);
      setFieldValue("profile-location", buyer.location);
      setFieldValue("profile-market", buyer.market);
      setFieldValue("profile-shop-address", buyer.shop_address);
      setFieldValue("profile-description", buyer.description);
    }
  }
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

async function saveProfile() {
  const statusEl = document.getElementById("profile-status");
  if (statusEl) statusEl.innerText = "";

  const isDistributor = currentUser.role === "distributor";
  const payload = {};

  if (isDistributor) {
    payload.business_name = getFieldValue("profile-business-name");
    payload.category = getFieldValue("profile-category");
  } else {
    payload.name = getFieldValue("profile-name");
    payload.looking_for = getFieldValue("profile-looking-for");
  }

  payload.location = getFieldValue("profile-location");
  payload.market = getFieldValue("profile-market");
  payload.shop_address = getFieldValue("profile-shop-address");
  payload.description = getFieldValue("profile-description");

  const table = isDistributor ? "distributor_profiles" : "buyer_profiles";
  const { error } = await sb.from(table).update(payload).eq("id", currentUser.id);

  if (error) {
    if (statusEl) statusEl.innerText = "Error saving profile.";
  } else {
    currentUser = { ...currentUser, ...payload };
    const banner = document.getElementById("profile-saved-banner");
    if (banner) {
      banner.style.display = "block";
      setTimeout(() => { banner.style.display = "none"; }, 3000);
    }
    checkOnboarding();
  }
}

function getFieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}
