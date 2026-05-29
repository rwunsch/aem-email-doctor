/* ================================================================
   AEM Email Doctor — Client-side application logic
   ================================================================ */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let ws = null;
let allFindings = [];
let currentTokens = null;
const logs = [];

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    const tabId = "tab-" + btn.dataset.tab;
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener("open", () => {
    document.getElementById("wsIndicator").classList.add("connected");
    document.getElementById("wsIndicator").title = "WebSocket connected";
    appendLog("[WS] Connected");
  });

  ws.addEventListener("close", () => {
    document.getElementById("wsIndicator").classList.remove("connected");
    document.getElementById("wsIndicator").title = "WebSocket disconnected";
    appendLog("[WS] Disconnected — reconnecting in 3s");
    setTimeout(connectWs, 3000);
  });

  ws.addEventListener("message", (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.type === "findings" && Array.isArray(data.findings)) {
        mergeFindings(data.findings);
        renderFindings();
        updateSummary();
        appendLog(`[WS] Received ${data.findings.length} finding(s) for step ${data.step}`);
      }
    } catch {
      // ignore malformed messages
    }
  });
}

connectWs();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getConfig() {
  return {
    tenantId: val("cfgTenantId"),
    clientId: val("cfgClientId"),
    clientSecret: val("cfgClientSecret"),
    mailbox: val("cfgMailbox"),
    fromAddress: val("cfgFromAddress"),
    smtpPort: parseInt(val("cfgSmtpPort")) || 587,
    redirectUri: val("cfgRedirectUri") || "http://localhost:8080",
    scopes: val("cfgScopes").split(/[\s,]+/).filter(Boolean),
    testRecipient: val("cfgTestRecipient") || undefined,
  };
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

async function apiPost(path, body) {
  appendLog(`[API] POST ${path}`);
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  appendLog(`[API] ${path} -> ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Findings management
// ---------------------------------------------------------------------------
function mergeFindings(newFindings) {
  for (const f of newFindings) {
    const idx = allFindings.findIndex((e) => e.id === f.id);
    if (idx >= 0) {
      allFindings[idx] = f;
    } else {
      allFindings.push(f);
    }
  }
}

function renderFindings() {
  const container = document.getElementById("findingsList");
  let html = "<h3>Findings</h3>";

  if (allFindings.length === 0) {
    html += '<p class="muted">Run a scan or use the wizard to generate findings.</p>';
    container.innerHTML = html;
    return;
  }

  for (let i = 0; i < allFindings.length; i++) {
    const f = allFindings[i];
    html += `<div class="finding-item" onclick="showDetail(${i})">
      <span class="finding-badge ${f.severity}">${f.severity}</span>
      <span class="finding-title">${escHtml(f.title)}</span>
    </div>`;
  }

  container.innerHTML = html;
}

function showDetail(index) {
  const f = allFindings[index];
  if (!f) return;

  let html = `<h3>${escHtml(f.title)}</h3>`;
  html += section("ID", f.id);
  html += section("Severity", `<span class="finding-badge ${f.severity}">${f.severity}</span>`);
  html += section("Detail", escHtml(f.detail));
  if (f.fix) html += section("Fix", escHtml(f.fix));
  if (f.evidence) html += section("Evidence", `<code>${escHtml(f.evidence)}</code>`);
  if (f.docUrl) html += section("Adobe Doc", `<a href="${escHtml(f.docUrl)}" target="_blank" style="color:var(--accent)">${escHtml(f.docUrl)}</a>`);
  if (f.msDocUrl) html += section("Microsoft Doc", `<a href="${escHtml(f.msDocUrl)}" target="_blank" style="color:var(--accent)">${escHtml(f.msDocUrl)}</a>`);

  document.getElementById("findingDetail").innerHTML = html;
}

function section(label, value) {
  return `<div class="detail-section"><div class="detail-label">${label}</div><div class="detail-value">${value}</div></div>`;
}

function updateSummary() {
  let pass = 0, fail = 0, warn = 0, skip = 0;
  for (const f of allFindings) {
    if (f.severity === "pass") pass++;
    else if (f.severity === "fail") fail++;
    else if (f.severity === "warn") warn++;
    else if (f.severity === "skip") skip++;
  }
  document.getElementById("countPass").textContent = pass;
  document.getElementById("countFail").textContent = fail;
  document.getElementById("countWarn").textContent = warn;
  document.getElementById("countSkip").textContent = skip;

  // Hide getting-started card once there are findings
  const gs = document.getElementById("gettingStarted");
  if (gs && allFindings.length > 0) gs.style.display = "none";
}

function renderFindingsInline(findings, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = "";
  for (const f of findings) {
    html += `<div class="finding-item">
      <span class="finding-badge ${f.severity}">${f.severity}</span>
      <span class="finding-title">${escHtml(f.title)} — ${escHtml(f.detail)}</span>
    </div>`;
  }
  container.innerHTML = html;
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function appendLog(msg) {
  const ts = new Date().toLocaleTimeString();
  logs.push(`[${ts}] ${msg}`);
  if (logs.length > 500) logs.shift();
  const el = document.getElementById("logOutput");
  if (el) el.textContent = logs.join("\n");
}

function clearLogs() {
  logs.length = 0;
  document.getElementById("logOutput").textContent = "Logs cleared.";
}

// ---------------------------------------------------------------------------
// Wizard navigation
// ---------------------------------------------------------------------------
function wizardNext(step) {
  document.querySelectorAll(".wizard-panel").forEach((p) => p.classList.remove("active"));
  const panel = document.getElementById("wizStep" + step);
  if (panel) panel.classList.add("active");

  document.querySelectorAll(".step-dot").forEach((d) => {
    const s = parseInt(d.dataset.step);
    d.classList.remove("active", "done");
    if (s === step) d.classList.add("active");
    else if (s < step) d.classList.add("done");
  });
}

// ---------------------------------------------------------------------------
// Wizard actions
// ---------------------------------------------------------------------------

// Step 3: Validate
async function runValidate() {
  const btn = document.getElementById("btnValidate");
  btn.disabled = true;
  btn.textContent = "Validating...";

  try {
    const config = getConfig();
    const data = await apiPost("/api/validate", config);
    mergeFindings(data.findings);
    renderFindings();
    updateSummary();
    renderFindingsInline(data.findings, "validateResults");
  } catch (err) {
    appendLog("[ERROR] Validate failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Validate Config";
  }
}

// OAuth mode toggle
function setOAuthMode(mode) {
  const authCodePanel = document.getElementById("oauthModeAuthCode");
  const refreshPanel = document.getElementById("oauthModeRefresh");
  const btnAuthCode = document.getElementById("btnModeAuthCode");
  const btnRefresh = document.getElementById("btnModeRefresh");

  if (mode === "refresh") {
    authCodePanel.style.display = "none";
    refreshPanel.style.display = "block";
    btnAuthCode.classList.remove("active");
    btnRefresh.classList.add("active");
  } else {
    authCodePanel.style.display = "block";
    refreshPanel.style.display = "none";
    btnAuthCode.classList.add("active");
    btnRefresh.classList.remove("active");
  }
}

// Step 4 (alt): Use existing refresh token
async function useRefreshToken() {
  const refreshToken = document.getElementById("existingRefreshToken").value.trim();
  if (!refreshToken) {
    appendLog("[ERROR] No refresh token entered");
    return;
  }

  const btn = document.getElementById("btnRefreshExchange");
  btn.disabled = true;
  btn.textContent = "Exchanging...";

  try {
    const config = getConfig();
    const data = await apiPost("/api/oauth/refresh", { config, refreshToken });

    if (data.tokens) {
      currentTokens = data.tokens;
      showTokenStatus(data.tokens);
      appendLog("[OAuth] Access token obtained from refresh token");
    }

    if (data.findings) {
      mergeFindings(data.findings);
      renderFindings();
      updateSummary();
      renderFindingsInline(data.findings, "oauthResults");
    }
  } catch (err) {
    appendLog("[ERROR] Refresh token exchange failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Exchange Refresh Token";
  }
}

// Step 4: OAuth start
async function startOAuth() {
  const btn = document.getElementById("btnOAuthStart");
  btn.disabled = true;

  try {
    const config = getConfig();
    const data = await apiPost("/api/oauth/start", config);
    document.getElementById("oauthUrl").textContent = data.url;
    document.getElementById("oauthUrlArea").style.display = "block";
    appendLog("[OAuth] Authorization URL generated");
  } catch (err) {
    appendLog("[ERROR] OAuth start failed: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

// Step 4: Exchange code
async function exchangeCode() {
  const code = val("oauthCode");
  if (!code) {
    appendLog("[ERROR] No authorization code entered");
    return;
  }

  try {
    const config = getConfig();
    const data = await apiPost("/api/oauth/exchange", { config, code });

    if (data.tokens) {
      currentTokens = data.tokens;
      showTokenStatus(data.tokens);
      appendLog("[OAuth] Tokens received" + (data.tokens.refreshToken ? " (with refresh token)" : ""));
    }

    if (data.findings) {
      mergeFindings(data.findings);
      renderFindings();
      updateSummary();
      renderFindingsInline(data.findings, "oauthResults");
    }
  } catch (err) {
    appendLog("[ERROR] Code exchange failed: " + err.message);
  }
}

// Step 5: SMTP test
async function runSmtpTest() {
  const container = document.getElementById("smtpResults");

  if (!currentTokens || !(currentTokens.accessToken || currentTokens.latestAccessToken)) {
    const hasRefreshToken = document.getElementById("existingRefreshToken") &&
      document.getElementById("existingRefreshToken").value.trim().length > 0;
    const msg = hasRefreshToken
      ? 'A refresh token is present but has not been exchanged yet. Go to Step 4, select "Use Existing Refresh Token", and click "Exchange Refresh Token" to get an access token first.'
      : "No access token available. Complete the OAuth2 step (Step 4) first to obtain an access token.";
    appendLog("[ERROR] " + msg);
    container.innerHTML =
      '<div class="finding-item"><span class="finding-badge fail">ERROR</span>' +
      '<span class="finding-title">' + escHtml(msg) + '</span></div>';
    return;
  }

  const btn = document.getElementById("btnSmtpTest");
  btn.disabled = true;
  btn.textContent = "Connecting to smtp.office365.com:587...";
  container.innerHTML =
    '<div class="finding-item"><span class="finding-badge skip">...</span>' +
    '<span class="finding-title">Connecting to smtp.office365.com:587 — this may take a few seconds...</span></div>';

  try {
    const config = getConfig();
    const sendTestEmail = document.getElementById("chkSendTest").checked;
    const accessToken = currentTokens.latestAccessToken || currentTokens.accessToken;

    const data = await apiPost("/api/smtp/test", { config, accessToken, sendTestEmail });

    if (data.findings && data.findings.length > 0) {
      mergeFindings(data.findings);
      renderFindings();
      updateSummary();
      renderFindingsInline(data.findings, "smtpResults");
    } else {
      container.innerHTML =
        '<div class="finding-item"><span class="finding-badge warn">WARN</span>' +
        '<span class="finding-title">SMTP test completed but returned no findings.</span></div>';
    }

    if (data.result && data.result.transcript) {
      appendLog("[SMTP] Transcript:\n" + data.result.transcript.join("\n"));
    }

    if (data.result && data.result.error) {
      appendLog("[SMTP] Error: " + data.result.error);
    }
  } catch (err) {
    const msg = "SMTP test failed: " + err.message;
    appendLog("[ERROR] " + msg);
    container.innerHTML =
      '<div class="finding-item"><span class="finding-badge fail">ERROR</span>' +
      '<span class="finding-title">' + escHtml(msg) + '</span></div>';
  } finally {
    btn.disabled = false;
    btn.textContent = "Test SMTP";
  }
}

// Step 6: Generate configs
async function generateConfigs() {
  const btn = document.getElementById("btnGenConfig");
  btn.disabled = true;
  btn.textContent = "Generating...";

  try {
    const config = getConfig();
    const refreshToken = currentTokens ? currentTokens.refreshToken : undefined;

    const data = await apiPost("/api/config/generate", { config, refreshToken });

    // Update Config tab
    document.getElementById("oauthConfigPre").textContent = data.oauthConfig || "N/A";
    document.getElementById("mailConfigPre").textContent = data.mailServiceConfig || "N/A";
    document.getElementById("cmVarsPre").textContent =
      typeof data.cmVariables === "string" ? data.cmVariables : JSON.stringify(data.cmVariables, null, 2);

    // Also show in wizard results
    document.getElementById("configResults").innerHTML =
      '<div class="finding-item"><span class="finding-badge pass">done</span>' +
      '<span class="finding-title">Configs generated. See the Config tab for full output.</span></div>';

    appendLog("[Config] Generated OAuth, Mail Service, and CM variable configs");
  } catch (err) {
    appendLog("[ERROR] Config generation failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Configs";
  }
}

// ---------------------------------------------------------------------------
// Token status display
// ---------------------------------------------------------------------------
function showTokenStatus(tokens) {
  const el = document.getElementById("tokenStatus");
  el.style.display = "block";

  let html = "<table style='width:100%;font-size:0.85rem'>";
  html += row("Access Token", tokens.accessToken ? truncate(tokens.accessToken, 40) + " (" + tokens.accessToken.length + " chars)" : "N/A");
  html += row("Refresh Token", tokens.refreshToken ? truncate(tokens.refreshToken, 40) + " (" + tokens.refreshToken.length + " chars)" : "Missing");
  html += row("Expires In", tokens.expiresIn ? tokens.expiresIn + "s" : "N/A");
  html += row("Token Type", tokens.tokenType || "N/A");
  if (tokens.scope) html += row("Scope", tokens.scope);
  html += "</table>";

  document.getElementById("tokenInfo").innerHTML = html;
}

function row(label, value) {
  return `<tr><td style="color:var(--text-muted);padding:4px 8px 4px 0;white-space:nowrap">${label}</td><td style="padding:4px 0;font-family:var(--font-mono);font-size:0.8rem">${escHtml(value)}</td></tr>`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

// ---------------------------------------------------------------------------
// Secret field visibility toggle
// ---------------------------------------------------------------------------
function toggleVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const eyeOpen = btn.querySelector(".eye-open");
  const eyeClosed = btn.querySelector(".eye-closed");

  if (input.type === "password") {
    input.type = "text";
    eyeOpen.style.display = "none";
    eyeClosed.style.display = "block";
  } else {
    input.type = "password";
    eyeOpen.style.display = "block";
    eyeClosed.style.display = "none";
  }
}

function toggleTextareaVisibility(textareaId, btn) {
  const textarea = document.getElementById(textareaId);
  const eyeOpen = btn.querySelector(".eye-open");
  const eyeClosed = btn.querySelector(".eye-closed");

  if (textarea.classList.contains("visible")) {
    textarea.classList.remove("visible");
    eyeOpen.style.display = "block";
    eyeClosed.style.display = "none";
  } else {
    textarea.classList.add("visible");
    eyeOpen.style.display = "none";
    eyeClosed.style.display = "block";
  }
}

// ---------------------------------------------------------------------------
// Copy to clipboard
// ---------------------------------------------------------------------------
function copyConfig(preId) {
  const text = document.getElementById(preId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    appendLog("[UI] Copied to clipboard");
  }).catch(() => {
    appendLog("[UI] Copy failed — use Ctrl+C");
  });
}
