// ==========================================================================
// GoodsbarnX — inquiries.js
// Buyer inquiries, inquiry submission, inquiry history, inquiry detail,
// controlled product-clarification readiness, buyer evidence recovery.
// Plain global script. Loads fifth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2:
//   - Absorbed inline goodsbarnx-v162-live-ledger (V1.6.2).
//   - Absorbed inline goodsbarnx-v1715-live-action (V1.7.15).
//   - Absorbed inline goodsbarnx-v1721-...-recovery (V1.7.21).
//   - D12 completion: SECRET removed. Notification request authenticates
//     with the buyer's Supabase JWT (Authorization: Bearer <token>).
//     Backend deliverable S5 must verify the JWT.
//   - Removed the hardcoded "Evidence #3" assumption from the recovery
//     card; submission number is now derived from persisted history.
//   - Single writer of #history-list (previously also written by app.js).
//   - Registered an "inquiries" screen loader (Phase 2.3).
// ==========================================================================

// ==========================================================================
// STATE
// ==========================================================================

const inquiryLedgerCache = {
  rows: [],
  evidence: [],
  profiles: {},
  relationships: []
};

const CLOSED_STATUSES = ["closed", "resolved", "completed"];

const __gbxInqWarned = Object.create(null);
function inqWarnMissing(id) {
  if (__gbxInqWarned[id]) return;
  __gbxInqWarned[id] = true;
  console.warn("[GoodsbarnX/inquiries] DOM target #" + id + " is missing from index.html.");
}

// ==========================================================================
// SMALL HELPERS
// ==========================================================================

function inquiryEscapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function inquiryEscapeAttr(v) { return inquiryEscapeHtml(v); }

function inquiryStatus(v) {
  const s = String(v || "open").trim();
  return s || "Open";
}
function inquiryIsClosed(v) {
  return CLOSED_STATUSES.indexOf(String(v || "").toLowerCase()) !== -1;
}
function inquiryFormatDate(v) {
  if (!v) return "Date unavailable";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) :
    d.toLocaleString("en-NG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ==========================================================================
// SUBMIT INQUIRY (V1.6.1 attribution)
// ==========================================================================

async function submitInquiry() {
  const nameEl  = document.getElementById("inquiry-name");
  const phoneEl = document.getElementById("inquiry-phone");
  const emailEl = document.getElementById("inquiry-email");
  const itemEl  = document.getElementById("inquiry-item");
  const qtyEl   = document.getElementById("inquiry-quantity");
  const statusEl= document.getElementById("status-msg");

  const name  = nameEl  ? nameEl.value.trim()  : "";
  const phone = phoneEl ? phoneEl.value.trim() : "";

  const showStatus = (msg) => { if (statusEl) statusEl.innerText = msg; };

  if (!name || !phone) { showStatus("Fill name and phone."); return; }
  if (!window.sb)      { showStatus("Connection service unavailable. Please refresh."); return; }

  const isAuthenticatedBuyer        = currentUser && currentUser.role === "buyer";
  const isAuthenticatedDistributor  = currentUser && currentUser.role === "distributor";

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
    buyerId = selectedContactType === "buyer" ? (selectedContactId || null) : null;
    distributorId = selectedContactType === "distributor" ? (selectedContactId || null) : null;
  }

  const payload = {
    inquirer_name:  name,
    inquirer_phone: phone,
    inquirer_email: emailEl ? emailEl.value || null : null,
    item:           itemEl  ? itemEl.value  || null : null,
    order_scale:    selectedTier || null,
    quantity:       qtyEl   ? qtyEl.value   || null : null,
    distributor_id: distributorId,
    buyer_id:       buyerId,
    contact_type:   selectedContactType,
    inquirer_id:    currentUser ? currentUser.id : null
  };

  const { error } = await sb.from("inquiries").insert(payload);
  if (error) {
    showStatus("Error: " + error.message);
    return;
  }

  // ------------------------------------------------------------------------
  // EMAIL NOTIFICATION (D12)
  //
  // The Supabase insert above is authoritative. The notification is a
  // best-effort side effect; it must not make the user believe the inquiry
  // itself failed if it does.
  //
  // The request is authenticated with the caller's Supabase JWT. If no
  // session is available (guest), the notification is skipped and logged.
  // No plaintext shared secret is transmitted. Backend deliverable S5.
  // ------------------------------------------------------------------------

  (async function notifyBackend() {
    if (typeof BACKEND !== "string" || !BACKEND) {
      console.warn("[GoodsbarnX/inquiries] BACKEND unavailable; notification skipped.");
      return;
    }

    let accessToken = null;
    try {
      const sessionResult = await sb.auth.getSession();
      accessToken = sessionResult?.data?.session?.access_token || null;
    } catch (err) {
      console.warn("[GoodsbarnX/inquiries] could not read session for notification:", err && err.message);
    }

    if (!accessToken) {
      console.warn("[GoodsbarnX/inquiries] no session token; notification skipped (inquiry row already saved).");
      return;
    }

    try {
      const response = await fetch(BACKEND + "/inquiries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + accessToken
        },
        body: JSON.stringify({
          name: name,
          phone: phone,
          email: payload.inquirer_email,
          distributor: selectedContactType === "distributor" ? selectedContactName : null,
          buyer:       selectedContactType === "buyer"       ? selectedContactName : null,
          contactType: selectedContactType,
          contactId:   selectedContactId
        })
      });

      if (!response.ok) {
        console.warn("[GoodsbarnX/inquiries] notification endpoint returned HTTP " + response.status);
      }
    } catch (err) {
      console.warn("[GoodsbarnX/inquiries] notification request failed:", err && err.message);
    }
  })();

  showStatus("Sent!");
  setTimeout(closeModal, 1500);
}

// ==========================================================================
// SUBMIT DISPUTE
// ==========================================================================

async function submitDispute() {
  const submittedByEl = document.getElementById("dispute-submitted-by");
  const phoneEl       = document.getElementById("dispute-phone");
  const descriptionEl = document.getElementById("dispute-description");
  const statusEl      = document.getElementById("dispute-status-msg");

  const submittedBy = submittedByEl ? submittedByEl.value : "";
  const phone       = phoneEl       ? phoneEl.value       : "";
  const description = descriptionEl ? descriptionEl.value : "";

  const showStatus = (msg) => { if (statusEl) statusEl.innerText = msg; };

  if (!submittedBy || !phone || !description) { showStatus("Fill all fields."); return; }
  if (!window.sb) { showStatus("Connection service unavailable. Please refresh."); return; }

  const { error } = await sb.from("disputes").insert({
    distributor_id: disputeTargetId,
    submitted_by: submittedBy,
    submitted_phone: phone,
    description: description,
    status: "Pending"
  });

  if (error) { showStatus("Error: " + error.message); return; }

  showStatus("Submitted!");
  setTimeout(closeDisputeModal, 1800);
}

// ==========================================================================
// LEDGER — DATA LOADING
// ==========================================================================

function ledgerRole() {
  try { return currentUser?.role || null; } catch (e) { return null; }
}
function ledgerUid() {
  try { return currentUser?.id || null; } catch (e) { return null; }
}

function ledgerVisibleQuery(id, role) {
  const base = "id,item,quantity,order_scale,status,created_at,responded_at," +
    "inquirer_name,inquirer_phone,inquirer_email,distributor_id,buyer_id," +
    "contact_type,inquirer_id";
  if (role === "distributor") {
    return sb.from("inquiries").select(base).eq("distributor_id", id).order("created_at", { ascending: false });
  }
  if (role === "buyer") {
    return sb.from("inquiries").select(base).or("buyer_id.eq." + id + ",inquirer_id.eq." + id).order("created_at", { ascending: false });
  }
  return sb.from("inquiries").select(base).eq("inquirer_id", id).order("created_at", { ascending: false });
}

function relationshipFor(i) {
  if (!i.buyer_id) return null;
  return inquiryLedgerCache.relationships.find(r =>
    r.buyer_id === i.buyer_id &&
    r.distributor_id === i.distributor_id &&
    r.is_primary !== false
  ) || null;
}

function relationshipLabel(i) {
  if (!i.buyer_id) return "Unattributed demand";
  const r = relationshipFor(i);
  if (!r) return "Relationship gap";
  return String(r.status || "").toLowerCase() === "active" ? "Relationship ready"
    : "Relationship " + String(r.status || "pending");
}

function renderLedgerSummary(rows) {
  const el = document.getElementById("gbx-ledger-summary");
  if (!el) { inqWarnMissing("gbx-ledger-summary"); return; }
  const open = rows.filter(x => !inquiryIsClosed(x.status)).length;
  const attributed = rows.filter(x => !!x.buyer_id).length;
  el.innerHTML =
    '<div class="gbx-ledger-stat"><b>' + rows.length + '</b><span>Total</span></div>' +
    '<div class="gbx-ledger-stat"><b>' + open + '</b><span>Open</span></div>' +
    '<div class="gbx-ledger-stat"><b>' + attributed + '</b><span>Attributed</span></div>';
}

function renderLedgerRows(rows) {
  const list = document.getElementById("history-list");
  if (!list) { inqWarnMissing("history-list"); return; }

  renderLedgerSummary(rows);

  if (!rows.length) {
    list.innerHTML =
      '<div class="gbx-ledger-empty">No live inquiries found for this account yet.<br>' +
      '<span style="opacity:.7">New demand signals will appear here after they are saved to GoodsbarnX.</span></div>';
    return;
  }

  const role = ledgerRole();

  list.innerHTML = rows.map(i => {
    const rel = relationshipLabel(i);
    const who = i.buyer_id
      ? (inquiryLedgerCache.profiles[i.buyer_id] || "Buyer identified")
      : role === "distributor"
        ? "Unattributed demand"
        : (i.inquirer_name || "You");

    const st = inquiryStatus(i.status);
    const sl = st.toLowerCase();
    const cls = inquiryIsClosed(st) ? " closed" : sl === "pending" ? " warn" : "";

    const qty = i.quantity
      ? " · " + inquiryEscapeHtml(i.quantity) + (i.order_scale ? " " + inquiryEscapeHtml(i.order_scale) : "")
      : "";

    return '<button type="button" class="gbx-inquiry-card" ' +
        'data-inquiry-id="' + inquiryEscapeAttr(i.id) + '" ' +
        'onclick="openInquiryDetail(this.dataset.inquiryId)">' +
      '<div class="gbx-inquiry-top">' +
        '<div class="gbx-inquiry-icon">▱</div>' +
        '<div class="gbx-inquiry-copy">' +
          '<div class="gbx-inquiry-item">' + inquiryEscapeHtml(i.item || "Unspecified demand") + '</div>' +
          '<div class="gbx-inquiry-meta">' + qty.replace(/^ · /, "") + ' · ' + inquiryEscapeHtml(inquiryFormatDate(i.created_at)) + '</div>' +
        '</div>' +
        '<span class="gbx-inquiry-status' + cls + '">' + inquiryEscapeHtml(st) + '</span>' +
      '</div>' +
      '<div class="gbx-inquiry-bottom">' +
        '<span class="gbx-inquiry-person">' + inquiryEscapeHtml(who) + '</span>' +
        '<span class="gbx-inquiry-route">' + inquiryEscapeHtml(rel) + '</span>' +
      '</div>' +
    '</button>';
  }).join("");
}

// ==========================================================================
// LEDGER — ENTRY POINT
// ==========================================================================

async function loadInquiryLedger() {
  const list = document.getElementById("history-list");
  if (!list) { inqWarnMissing("history-list"); return; }

  list.innerHTML = '<div class="gbx-ledger-empty">Reading live inquiries…</div>';

  const id = ledgerUid();
  const role = ledgerRole();

  if (!id) {
    list.innerHTML = '<div class="gbx-ledger-empty">Sign in to read your live inquiry ledger.</div>';
    return;
  }
  if (!window.sb) {
    list.innerHTML = '<div class="gbx-ledger-empty">Connection service unavailable.</div>';
    return;
  }

  try {
    const q = await ledgerVisibleQuery(id, role);
    if (q.error) throw q.error;

    const rows = q.data || [];
    inquiryLedgerCache.rows = rows;
    inquiryLedgerCache.profiles = {};
    inquiryLedgerCache.relationships = [];

    const buyerIds = [...new Set(rows.map(x => x.buyer_id).filter(Boolean))];
    if (buyerIds.length) {
      const bp = await sb.from("profiles").select("id,full_name,role").in("id", buyerIds);
      if (bp.error) throw bp.error;
      (bp.data || []).forEach(x => {
        if (x.role === "buyer") inquiryLedgerCache.profiles[x.id] = x.full_name || "Buyer";
      });
    }

    if (role === "distributor") {
      const rel = await sb.from("trade_relationships")
        .select("id,buyer_id,distributor_id,status,is_primary,activated_at")
        .eq("distributor_id", id);
      if (rel.error) throw rel.error;
      inquiryLedgerCache.relationships = rel.data || [];
    }

    const title = document.getElementById("gbx-ledger-title");
    if (title) title.textContent = role === "distributor" ? "Demand ledger" : "Your inquiries";

    renderLedgerRows(rows);
  } catch (error) {
    console.error("[GoodsbarnX/inquiries] ledger load failed:", error);
    list.innerHTML =
      '<div class="gbx-ledger-empty">Live inquiry ledger is temporarily unavailable.<br>' +
      '<span style="opacity:.7">' + inquiryEscapeHtml(error.message || String(error)) + '</span></div>';
  }
}

// ==========================================================================
// INQUIRY DETAIL
// ==========================================================================

function openInquiryDetail(id) {
  const i = inquiryLedgerCache.rows.find(x => x.id === id);
  if (!i) { console.warn("[GoodsbarnX/inquiries] openInquiryDetail: unknown inquiry", id); return; }

  const rel = relationshipLabel(i);
  const who = i.buyer_id
    ? (inquiryLedgerCache.profiles[i.buyer_id] || "Buyer identified")
    : "Unattributed demand";

  const wrap = document.createElement("div");
  wrap.id = "gbx-inquiry-detail-modal";
  wrap.className = "sheet-overlay";
  wrap.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.58);";

  wrap.innerHTML =
    '<div class="sheet gbx-detail-sheet" style="width:min(100%,520px);padding:24px;box-sizing:border-box;">' +
      '<div class="sheet-handle"></div>' +
      '<h3>' + inquiryEscapeHtml(i.item || "Inquiry") + '</h3>' +
      '<div class="sub">Live demand signal · ' + inquiryEscapeHtml(inquiryFormatDate(i.created_at)) + '</div>' +
      '<div class="gbx-detail-grid">' +
        '<div class="gbx-detail-cell"><span>Requester</span><strong>' + inquiryEscapeHtml(i.inquirer_name || who) + '</strong></div>' +
        '<div class="gbx-detail-cell"><span>Status</span><strong>' + inquiryEscapeHtml(inquiryStatus(i.status)) + '</strong></div>' +
        '<div class="gbx-detail-cell"><span>Quantity</span><strong>' + inquiryEscapeHtml(i.quantity || "Not specified") + '</strong></div>' +
        '<div class="gbx-detail-cell"><span>Order scale</span><strong>' + inquiryEscapeHtml(i.order_scale || "Not specified") + '</strong></div>' +
        '<div class="gbx-detail-cell gbx-detail-full"><span>Relationship</span><strong>' + inquiryEscapeHtml(rel) + '</strong></div>' +
        '<div class="gbx-detail-cell gbx-detail-full"><span>Contact</span><strong>' +
          inquiryEscapeHtml(i.inquirer_phone || "Not supplied") +
          (i.inquirer_email ? ' · ' + inquiryEscapeHtml(i.inquirer_email) : "") +
        '</strong></div>' +
      '</div>' +
      '<div class="gbx-v1715-slot"></div>' +
      '<button class="cancel-btn" type="button" onclick="closeInquiryDetail()">Close</button>' +
    '</div>';

  document.body.appendChild(wrap);
  wrap.addEventListener("click", function (e) { if (e.target === wrap) closeInquiryDetail(); });

  // Attach the clarification-readiness action (was V1.7.15 inline block).
  attachClarificationReadiness(wrap, i);
}

function closeInquiryDetail() {
  const modal = document.getElementById("gbx-inquiry-detail-modal");
  if (modal) modal.remove();
}

// ==========================================================================
// CLARIFICATION READINESS (absorbed from goodsbarnx-v1715-live-action)
// ==========================================================================

async function currentIdentity(inquiry) {
  if (!window.sb) return null;

  if (inquiry.buyer_id) {
    const p = await sb.from("profiles").select("id,full_name,role,phone").eq("id", inquiry.buyer_id).maybeSingle();
    if (p.error) throw p.error;
    if (p.data?.role === "buyer") return p.data;
  }
  if (inquiry.inquirer_id) {
    const ip = await sb.from("profiles").select("id,full_name,role,phone").eq("id", inquiry.inquirer_id).maybeSingle();
    if (ip.error) throw ip.error;
    if (ip.data?.role === "buyer") return ip.data;
  }
  if (inquiry.inquirer_phone) {
    const ph = await sb.from("profiles").select("id,full_name,role,phone")
      .eq("role", "buyer").eq("phone", inquiry.inquirer_phone);
    if (ph.error) throw ph.error;
    if ((ph.data || []).length === 1) return ph.data[0];
  }
  return null;
}

async function inquiryReadiness(inquiryId, buyerId) {
  const r = await sb.rpc("get_product_clarification_readiness", {
    p_inquiry_id: inquiryId,
    p_buyer_id: buyerId
  });
  if (r.error) throw r.error;
  return r.data;
}

async function attachClarificationReadiness(modal, inquiry) {
  const slot = modal.querySelector(".gbx-v1715-slot");
  if (!slot) return;
  if (!currentUser || currentUser.role !== "distributor") return;
  if (!window.sb) return;

  let buyer;
  try {
    buyer = await currentIdentity(inquiry);
  } catch (err) {
    console.warn("[GoodsbarnX/inquiries] clarification identity lookup failed:", err && err.message);
    return;
  }
  if (!buyer || !buyer.id) return;

  const box = document.createElement("div");
  box.className = "gbx-v1715-action";
  box.style.cssText = "margin-top:16px;padding:13px;border:1px solid rgba(214,168,58,.25);border-radius:14px;background:rgba(15,20,17,.04);";
  box.innerHTML =
    '<div style="font-size:11px;font-weight:800;">PRODUCT IDENTITY</div>' +
    '<div class="gbx-v1715-copy" style="font-size:9px;line-height:1.45;margin-top:4px;opacity:.72;">Checking whether a controlled clarification request is justified…</div>' +
    '<button type="button" class="gbx-v1715-btn" style="margin-top:9px;border:0;background:var(--gbx-gold, #D6A83A);color:#111;padding:9px 11px;border-radius:9px;font-size:9px;font-weight:800;display:none;">ASK BUYER TO CLARIFY</button>';
  slot.appendChild(box);

  const copy = box.querySelector(".gbx-v1715-copy");
  const btn  = box.querySelector(".gbx-v1715-btn");

  try {
    const e = await inquiryReadiness(inquiry.id, buyer.id);

    if (e && e.route === "inter_distributor_coordination" && e.clarification_state === "ready_for_request") {
      copy.textContent = "The buyer is verified, but product identity is not deterministic. A controlled evidence request can be created for buyer review.";
      btn.style.display = "inline-block";
      btn.onclick = async function () {
        if (box.dataset.running === "1") return;
        box.dataset.running = "1";
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "CREATING…";
        try {
          const r = await sb.rpc("create_product_clarification_request", {
            p_inquiry_id: inquiry.id,
            p_buyer_id: buyer.id,
            p_authorize: true
          });
          if (r.error) throw r.error;
          const d = r.data || {};
          if (d.request_state === "created") {
            copy.textContent = "Request created and audited. Waiting for buyer evidence.";
            btn.textContent = "REQUEST CREATED";
            btn.style.opacity = ".6";
          } else if (d.request_state === "existing") {
            copy.textContent = "An outstanding clarification request already exists. No duplicate was created.";
            btn.textContent = "REQUEST ALREADY OPEN";
            btn.style.opacity = ".6";
          } else if (d.request_state === "authorization_required") {
            copy.textContent = "Server refused creation because explicit authorization was not supplied.";
            btn.disabled = false;
            btn.textContent = original;
          } else {
            copy.textContent = d.reason || "Request was not created.";
            btn.disabled = false;
            btn.textContent = original;
          }
        } catch (err) {
          console.error("[GoodsbarnX/inquiries] clarification request failed:", err);
          copy.textContent = "Request failed: " + (err.message || String(err));
          btn.disabled = false;
          btn.textContent = original;
        } finally {
          box.dataset.running = "0";
        }
      };
    } else if (e && e.clarification_state === "not_required") {
      box.remove();
    } else {
      copy.textContent = "No controlled clarification request is justified from the current evidence.";
      btn.remove();
    }
  } catch (err) {
    console.error("[GoodsbarnX/inquiries] clarification readiness failed:", err);
    copy.textContent = "Clarification readiness is temporarily unavailable.";
    btn.remove();
  }
}

// ==========================================================================
// BUYER EVIDENCE RECOVERY (absorbed from goodsbarnx-v1721-...-recovery)
//
// The payload hardcoded "Evidence #3" against a frozen scenario. This
// version derives the submission number from persisted history and
// compares it against the actual latest, per Canon §29.
// ==========================================================================

async function loadBuyerEvidenceRecovery() {
  const box = document.getElementById("gbx-buyer-evidence");
  if (!box) return;
  if (!currentUser || currentUser.role !== "buyer") { box.style.display = "none"; return; }
  if (!window.sb) { box.style.display = "none"; return; }

  let authUser;
  try {
    const auth = await sb.auth.getUser();
    if (auth.error) throw auth.error;
    authUser = auth.data && auth.data.user;
  } catch (err) {
    console.warn("[GoodsbarnX/inquiries] evidence recovery: auth unavailable:", err && err.message);
    box.style.display = "none";
    return;
  }
  if (!authUser) { box.style.display = "none"; return; }

  try {
    const reqs = await sb
      .from("product_clarification_requests")
      .select("id,inquiry_id,buyer_id,requesting_distributor_id,status,request_package,request_message,created_at")
      .eq("buyer_id", authUser.id)
      .eq("status", "pending_buyer_response")
      .order("created_at", { ascending: false })
      .limit(10);

    if (reqs.error) throw reqs.error;
    if (!reqs.data || !reqs.data.length) { box.style.display = "none"; return; }

    const eligible = [];
    for (const request of reqs.data) {
      const [events, evidence] = await Promise.all([
        sb.from("product_clarification_request_events")
          .select("id,event_type,actor_id,metadata,created_at")
          .eq("request_id", request.id)
          .order("created_at", { ascending: false })
          .limit(20),
        sb.from("product_clarification_evidence_submissions")
          .select("id,submission_number,validation_state,exact_product_name,brand_manufacturer,specification,packaging_unit,requested_quantity,additional_notes,submitted_at")
          .eq("request_id", request.id)
          .order("submission_number", { ascending: false })
          .limit(20)
      ]);
      if (events.error) throw events.error;
      if (evidence.error) throw evidence.error;

      const moreEvent = (events.data || []).find(e => e.event_type === "additional_evidence_requested");
      if (moreEvent) eligible.push({ request, moreEvent, evidence: evidence.data || [] });
    }

    if (!eligible.length) { box.style.display = "none"; return; }

    const item = eligible[0];
    const request = item.request;
    const pkg = request.request_package || {};
    const ev = item.evidence || [];

    const nextNumber = (ev.length ? Number(ev[0].submission_number) : 0) + 1;
    const required = pkg.required_evidence || [
      "exact product name",
      "brand or manufacturer (if applicable)",
      "size, weight, volume, or model/specification",
      "packaging/unit configuration",
      "requested quantity"
    ];

    box.style.display = "block";
    box.innerHTML =
      '<div class="v1721-card">' +
        '<div class="v1721-kicker">Action required</div>' +
        '<div class="v1721-title">Provide Evidence #' + nextNumber + '</div>' +
        '<div class="v1721-copy">The distributor reviewed your previous product evidence and requested additional evidence. This form records your answer exactly as supplied; it does not decide or substitute the product.</div>' +
        '<div class="v1721-meta"><b>Demand:</b> ' + inquiryEscapeHtml(pkg.demand_item || "Unspecified item") + '<br><b>Required:</b> ' + inquiryEscapeHtml(required.join(", ")) + '</div>' +
        '<form id="gbx-evidence-form">' +
          '<div class="v1721-grid">' +
            '<div class="v1721-field full"><label>Exact product name *</label><input name="exact_product_name" required autocomplete="off"></div>' +
            '<div class="v1721-field"><label>Brand / manufacturer</label><input name="brand_manufacturer" autocomplete="off"></div>' +
            '<div class="v1721-field"><label>Size / weight / volume / model *</label><input name="specification" required autocomplete="off"></div>' +
            '<div class="v1721-field"><label>Packaging / unit configuration *</label><input name="packaging_unit" required autocomplete="off"></div>' +
            '<div class="v1721-field"><label>Requested quantity *</label><input name="requested_quantity" required autocomplete="off"></div>' +
            '<div class="v1721-field full"><label>Additional notes</label><textarea name="additional_notes"></textarea></div>' +
          '</div>' +
          '<button class="v1721-submit" type="submit">SUBMIT EVIDENCE #' + nextNumber + '</button>' +
          '<div id="gbx-evidence-status" class="v1721-status"></div>' +
        '</form>' +
        '<div class="v1721-history"><b style="font-size:9px">Submission history</b>' +
          (ev.length
            ? ev.map(x => '<div class="v1721-history-row"><b>Evidence #' + inquiryEscapeHtml(x.submission_number) + '</b> · ' + inquiryEscapeHtml(x.validation_state) + ' · ' + inquiryEscapeHtml(x.exact_product_name || "No exact name") + '</div>').join("")
            : '<div class="v1721-history-row">No evidence submissions recorded.</div>') +
        '</div>' +
        '<div class="v1721-note">Your response remains buyer-supplied evidence. GoodsbarnX will not treat submission as product identity truth until the controlled identity-resolution and review layers complete.</div>' +
      '</div>';

    const form = document.getElementById("gbx-evidence-form");
    const status = document.getElementById("gbx-evidence-status");
    const submitBtn = form ? form.querySelector("button") : null;

    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (form.dataset.running === "1") return;
      form.dataset.running = "1";
      if (submitBtn) submitBtn.disabled = true;
      if (status) status.textContent = "Submitting…";

      try {
        const fd = new FormData(form);
        const rpc = await sb.rpc("submit_recovered_product_evidence_cycle", {
          p_request_id: request.id,
          p_exact_product_name: fd.get("exact_product_name"),
          p_brand_manufacturer: fd.get("brand_manufacturer") || null,
          p_specification: fd.get("specification"),
          p_packaging_unit: fd.get("packaging_unit"),
          p_requested_quantity: fd.get("requested_quantity"),
          p_additional_notes: fd.get("additional_notes") || null
        });
        if (rpc.error) throw rpc.error;
        const d = rpc.data || {};
        if (d.submission_state !== "submitted") throw new Error(d.reason || "Evidence was not accepted.");
        if (status) status.textContent = "Evidence #" + d.submission_number + " submitted. Product identity remains pending controlled review.";
        form.reset();
        setTimeout(loadBuyerEvidenceRecovery, 500);
      } catch (err) {
        if (status) status.textContent = "Submission failed: " + (err.message || String(err));
      } finally {
        form.dataset.running = "0";
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  } catch (err) {
    console.error("[GoodsbarnX/inquiries] evidence recovery load failed:", err);
    box.style.display = "none";
  }
}

// ==========================================================================
// SCREEN LOADER REGISTRATION (Phase 2.3)
// ==========================================================================

(function registerInquiriesScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/inquiries] registerScreenLoader unavailable; inquiries screen has no loader.");
    return;
  }
  registerScreenLoader("inquiries", async function inquiriesLoader() {
    await loadInquiryLedger();
    await loadBuyerEvidenceRecovery();
  });
})();

// ==========================================================================
// ONLINE / VISIBILITY RETRY
// ==========================================================================

window.addEventListener("online", function () {
  setTimeout(function () {
    if (document.getElementById("screen-inquiries")?.classList.contains("active")) {
      loadInquiryLedger();
    }
  }, 500);
});

// ==========================================================================
// GLOBAL EXPORTS
// ==========================================================================

window.submitInquiry = submitInquiry;
window.submitDispute = submitDispute;

window.loadInquiryLedger    = loadInquiryLedger;
window.openInquiryDetail    = openInquiryDetail;
window.closeInquiryDetail   = closeInquiryDetail;

window.loadBuyerEvidenceRecovery = loadBuyerEvidenceRecovery;

console.log("[GoodsbarnX] inquiries.js loaded.");
