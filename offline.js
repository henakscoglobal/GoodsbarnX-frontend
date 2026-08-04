// ---------- Offline queue ----------
function queueInquiry(payload, name, type) {
  try {
    const q = JSON.parse(localStorage.getItem("shelfmatch_queue") || "[]");
    q.push({ payload, contactName: name, contactType: type });
    localStorage.setItem("shelfmatch_queue", JSON.stringify(q));
    updateQueueBadge();
  } catch (e) { console.error(e); }
}

function processQueue() {
  let q = [];
  try { q = JSON.parse(localStorage.getItem("shelfmatch_queue") || "[]"); } catch (e) { q = []; }
  if (q.length === 0) return;
  const remaining = [];
  q.forEach(item => {
    sb.from("inquiries").insert(item.payload).then(({ error }) => {
      if (error) {
        remaining.push(item);
      } else {
        saveInquiryToHistory(item.contactName, item.contactType);
        fetch(BACKEND + "/notify-inquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: SECRET,
            name: item.payload.inquirer_name,
            phone: item.payload.inquirer_phone,
            email: item.payload.inquirer_email,
            item: item.payload.item,
            orderScale: item.payload.order_scale,
            quantity: item.payload.quantity,
            contactedName: item.contactName,
            contactType: item.contactType,
          }),
        }).catch(() => {});
      }
      localStorage.setItem("shelfmatch_queue", JSON.stringify(remaining));
      updateQueueBadge();
    });
  });
}

function updateQueueBadge() {
  let q = [];
  try { q = JSON.parse(localStorage.getItem("shelfmatch_queue") || "[]"); } catch (e) { q = []; }
  const badge = document.getElementById("queue-badge");
  if (q.length > 0) {
    badge.style.display = "block";
    badge.innerText = q.length + " inquiry" + (q.length > 1 ? "ies" : "") + " waiting to send";
  } else {
    badge.style.display = "none";
  }
}

window.addEventListener("online", processQueue);
window.addEventListener("load", () => {
  updateQueueBadge();
  if (navigator.onLine) processQueue();
});

// ---------- History (Inquiries tab) ----------
function saveInquiryToHistory(name, type) {
  try {
    const h = JSON.parse(localStorage.getItem("shelfmatch_history") || "[]");
    h.unshift({ name, type, date: new Date().toLocaleString() });
    localStorage.setItem("shelfmatch_history", JSON.stringify(h.slice(0, 50)));
  } catch (e) { console.error(e); }
}

function renderHistory() {
  const list = document.getElementById("history-list");
  let h = [];
  try { h = JSON.parse(localStorage.getItem("shelfmatch_history") || "[]"); } catch (e) { h = []; }
  if (h.length === 0) {
    list.innerHTML = '<div class="loading-text">No inquiries sent yet on this device.</div>';
    return;
  }
  list.innerHTML = h.map(item => `
    <div class="manifest">
      <div class="inq-item">
        <div><div class="inq-name">${item.name}</div><div class="inq-sub">${item.type === 'distributor' ? 'Contacted distributor' : 'Contacted buyer'} · ${item.date}</div></div>
        <div class="stamp-badge">SENT</div>
      </div>
    </div>`).join("");
}

// Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
