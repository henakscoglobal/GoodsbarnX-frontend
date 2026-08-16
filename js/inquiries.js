// ==========================================================================
// GoodsbarnX — inquiries.js
// Submitting inquiries and disputes.
// Plain global script — depends on js/config.js (for `sb`) and js/ui.js
// (for closeModal, closeDisputeModal) being loaded first.
// Depends on global state vars (selectedTier, selectedContactType,
// selectedContactId, currentUser, disputeTargetId) declared in the main
// inline script in index.html.
// ==========================================================================

async function submitInquiry() {
  const name = document.getElementById("inquiry-name").value;
  const phone = document.getElementById("inquiry-phone").value;

  if (!name || !phone) {
    document.getElementById("status-msg").innerText = "Fill name and phone.";
    return;
  }

  const payload = {
    inquirer_name: name,
    inquirer_phone: phone,
    inquirer_email: document.getElementById("inquiry-email").value || null,
    item: document.getElementById("inquiry-item").value || null,
    order_scale: selectedTier || null,
    quantity: document.getElementById("inquiry-quantity").value || null,
    distributor_id: selectedContactType === "distributor" ? selectedContactId : null,
    buyer_id: selectedContactType === "buyer" ? selectedContactId : null,
    contact_type: selectedContactType,
    inquirer_id: currentUser?.id || null
  };

  const { error } = await sb.from("inquiries").insert(payload);

  if (error) {
    document.getElementById("status-msg").innerText = "Error: " + error.message;
    return;
  }

  document.getElementById("status-msg").innerText = "Sent!";
  setTimeout(closeModal, 1500);
}

async function submitDispute() {
  const submittedBy = document.getElementById("dispute-submitted-by").value;
  const phone = document.getElementById("dispute-phone").value;
  const description = document.getElementById("dispute-description").value;

  if (!submittedBy || !phone || !description) {
    document.getElementById("dispute-status-msg").innerText = "Fill all fields.";
    return;
  }

  await sb.from("disputes").insert({
    distributor_id: disputeTargetId,
    submitted_by: submittedBy,
    submitted_phone: phone,
    description: description,
    status: "Pending"
  });

  document.getElementById("dispute-status-msg").innerText = "Submitted!";
  setTimeout(closeDisputeModal, 1800);
}
