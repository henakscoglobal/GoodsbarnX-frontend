// ==========================================================================
// GoodsbarnX — inquiries.js
// V1.6.1 — Inquiry Attribution Capture
//
// Submitting inquiries and disputes.
// Plain global script — depends on js/config.js (for `sb`) and js/ui.js
// (for closeModal, closeDisputeModal) being loaded first.
// Depends on global state vars (selectedTier, selectedContactType,
// selectedContactId, selectedContactName, currentUser, disputeTargetId)
// declared in the main inline script in index.html.
//
// V1.6.1 attribution rule:
// - Authenticated buyer contacting a distributor:
//     buyer_id = currentUser.id
//     distributor_id = selectedContactId
// - Distributor contacting a buyer:
//     distributor_id = currentUser.id
//     buyer_id = selectedContactId
// - Other / unattributed paths preserve NULL rather than inventing identity.
// - inquirer_id remains the authenticated actor where available.
// ==========================================================================

async function submitInquiry() {
  const name = document.getElementById("inquiry-name").value.trim();
  const phone = document.getElementById("inquiry-phone").value.trim();

  if (!name || !phone) {
    document.getElementById("status-msg").innerText = "Fill name and phone.";
    return;
  }

  // ------------------------------------------------------------------------
  // CANONICAL PARTICIPANT ATTRIBUTION
  //
  // The previous implementation only populated buyer_id when the selected
  // contact itself was a buyer. That meant an authenticated buyer contacting
  // a distributor created an inquiry with buyer_id = NULL.
  //
  // V1.6.1 captures the buyer/distributor participants from the authenticated
  // actor and selected contact without changing the database schema.
  // ------------------------------------------------------------------------

  const isAuthenticatedBuyer = currentUser?.role === "buyer";
  const isAuthenticatedDistributor = currentUser?.role === "distributor";

  let buyerId = null;
  let distributorId = null;

  if (isAuthenticatedBuyer) {
    buyerId = currentUser.id;

    if (selectedContactType === "distributor") {
      distributorId = selectedContactId || null;
    }

  } else if (isAuthenticatedDistributor) {
    distributorId = currentUser.id;

    if (selectedContactType === "buyer") {
      buyerId = selectedContactId || null;
    }

  } else {
    // Preserve the existing target semantics for non-buyer/non-distributor
    // actors. Do not invent a participant identity.

    buyerId =
      selectedContactType === "buyer"
        ? selectedContactId || null
        : null;

    distributorId =
      selectedContactType === "distributor"
        ? selectedContactId || null
        : null;
  }

  const payload = {
    inquirer_name: name,
    inquirer_phone: phone,
    inquirer_email:
      document.getElementById("inquiry-email").value || null,

    item:
      document.getElementById("inquiry-item").value || null,

    order_scale:
      selectedTier || null,

    quantity:
      document.getElementById("inquiry-quantity").value || null,

    distributor_id:
      distributorId,

    buyer_id:
      buyerId,

    contact_type:
      selectedContactType,

    inquirer_id:
      currentUser?.id || null
  };

  const { error } = await sb
    .from("inquiries")
    .insert(payload);

  if (error) {
    document.getElementById("status-msg").innerText =
      "Error: " + error.message;
    return;
  }

  // ------------------------------------------------------------------------
  // EMAIL NOTIFICATION
  //
  // This remains non-blocking. The Supabase inquiry has already been saved,
  // so a notification failure must not make the user believe the inquiry
  // itself failed.
  // ------------------------------------------------------------------------

  fetch(BACKEND + "/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      secret: SECRET,

      name,
      phone,

      email:
        payload.inquirer_email,

      distributor:
        selectedContactType === "distributor"
          ? selectedContactName
          : null,

      buyer:
        selectedContactType === "buyer"
          ? selectedContactName
          : null,

      contactType:
        selectedContactType,

      contactId:
        selectedContactId
    })
  }).catch(err =>
    console.error(
      "Notification request failed:",
      err.message
    )
  );

  document.getElementById("status-msg").innerText = "Sent!";

  setTimeout(
    closeModal,
    1500
  );
}


// ==========================================================================
// DISPUTES
// ==========================================================================

async function submitDispute() {
  const submittedBy =
    document.getElementById("dispute-submitted-by").value;

  const phone =
    document.getElementById("dispute-phone").value;

  const description =
    document.getElementById("dispute-description").value;

  if (!submittedBy || !phone || !description) {
    document.getElementById("dispute-status-msg").innerText =
      "Fill all fields.";

    return;
  }

  await sb.from("disputes").insert({
    distributor_id: disputeTargetId,
    submitted_by: submittedBy,
    submitted_phone: phone,
    description: description,
    status: "Pending"
  });

  document.getElementById("dispute-status-msg").innerText =
    "Submitted!";

  setTimeout(
    closeDisputeModal,
    1800
  );
}
