const startButton = document.querySelector("#startAudit");
const statusCard = document.querySelector("#statusCard");
const markersCard = document.querySelector("#markersCard");
const markersEl = document.querySelector("#markers");
const resultCard = document.querySelector("#resultCard");
const requestCard = document.querySelector("#requestCard");
const endpointEl = document.querySelector("#endpoint");
const methodEl = document.querySelector("#method");
const statusCodeEl = document.querySelector("#statusCode");
const detectedMarkersEl = document.querySelector("#detectedMarkers");
const historyEl = document.querySelector("#history");
const clearHistoryButton = document.querySelector("#clearHistory");

let currentAudit = null;
let pollTimer = null;

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  setStatus("Starting audit...");

  const response = await sendMessage({ type: "START_AUDIT" });
  startButton.disabled = false;

  if (!response.ok) {
    setStatus(response.error || "Could not start audit.");
    return;
  }

  renderAudit(response.audit);
  startPolling();
});

clearHistoryButton.addEventListener("click", async () => {
  await sendMessage({ type: "CLEAR_HISTORY" });
  renderHistory([]);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "AUDIT_UPDATE") {
    renderAudit(message.audit);
    refreshHistory();
  }
});

init();

async function init() {
  const response = await sendMessage({ type: "GET_ACTIVE_AUDIT" });
  if (response.ok && response.audit) {
    renderAudit(response.audit);
    startPolling();
  } else {
    setStatus("Open the target page, then click START AUDIT.");
  }

  await refreshHistory();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const response = await sendMessage({ type: "GET_ACTIVE_AUDIT" });
    if (response.ok && response.audit) {
      renderAudit(response.audit);
      if (response.audit.status === "DONE") {
        clearInterval(pollTimer);
      }
    }
  }, 1000);
}

function renderAudit(audit) {
  currentAudit = audit;
  renderMarkers(audit.markers);

  if (audit.status === "WAITING_FOR_SUBMIT") {
    setStatus("Fill the target form with the dummy values, then submit it manually.");
  }

  if (audit.status === "WATCHING_REQUESTS") {
    const seconds = Math.ceil((audit.remainingMs || 0) / 1000);
    setStatus(`Submit detected. Watching requests for ${seconds}s...`);
  }

  if (audit.status === "DONE") {
    setStatus("Audit complete.");
    renderResult(audit);
    renderRequest(audit.requests[0]);
  } else {
    resultCard.classList.add("hidden");
    requestCard.classList.add("hidden");
  }
}

function renderMarkers(markers) {
  markersCard.classList.remove("hidden");
  markersEl.innerHTML = "";

  for (const [key, value] of Object.entries(markers)) {
    const item = document.createElement("div");
    item.className = "marker";
    item.innerHTML = `
      <div class="marker-label">${labelFor(key)}</div>
      <div class="marker-value"></div>
      <button class="copy" type="button">Copy</button>
    `;
    item.querySelector(".marker-value").textContent = value;
    item.querySelector(".copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(value);
      item.querySelector(".copy").textContent = "Copied";
      setTimeout(() => {
        item.querySelector(".copy").textContent = "Copy";
      }, 900);
    });
    markersEl.appendChild(item);
  }
}

function renderResult(audit) {
  resultCard.className = `result ${audit.verdict === "YES" ? "yes" : "no"}`;

  if (audit.verdict === "YES") {
    resultCard.innerHTML = `
      <div class="result-label">✅ YES</div>
      <div class="result-title">DATA SENT TO SERVER</div>
      <p class="result-copy">A non-analytics server request contained at least one dummy marker.</p>
    `;
    return;
  }

  resultCard.innerHTML = `
    <div class="result-label">❌ NO</div>
    <div class="result-title">NO SERVER SUBMISSION DETECTED</div>
    <p class="result-copy">No request containing the submitted dummy data was detected.</p>
  `;
}

function renderRequest(request) {
  if (!request || currentAudit?.verdict !== "YES") {
    requestCard.classList.add("hidden");
    return;
  }

  requestCard.classList.remove("hidden");
  endpointEl.textContent = request.endpoint;
  methodEl.textContent = request.method;
  statusCodeEl.textContent = request.statusCode ?? "No status code";
  detectedMarkersEl.textContent = request.detectedMarkers.join(", ");
}

async function refreshHistory() {
  const response = await sendMessage({ type: "GET_HISTORY" });
  if (response.ok) {
    renderHistory(response.history);
  }
}

function renderHistory(history) {
  historyEl.innerHTML = "";

  if (!history.length) {
    historyEl.innerHTML = `<p class="small">No local audits yet.</p>`;
    return;
  }

  for (const item of history.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "history-item";
    row.innerHTML = `
      <strong>${item.verdict === "YES" ? "YES - sent" : "NO - not detected"}</strong>
      <span></span>
    `;
    row.querySelector("span").textContent = item.host || item.targetUrl;
    historyEl.appendChild(row);
  }
}

function setStatus(message) {
  statusCard.classList.remove("hidden");
  statusCard.textContent = message;
}

function labelFor(key) {
  return {
    wallet: "Wallet",
    twitter: "X/Twitter",
    email: "Email",
    name: "Name",
  }[key] || key;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      resolve(response || { ok: false, error: "No response from extension background." });
    });
  });
}
