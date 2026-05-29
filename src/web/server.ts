import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type EmailConfig, type Finding, Severity, CheckStep, createFinding } from "../core/types.js";
import { validateConfig } from "../core/config-validator.js";
import { buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken } from "../core/oauth.js";
import { testSmtp } from "../core/smtp.js";
import { buildReport } from "../core/checklist.js";
import { generateOAuthConfig, generateMailServiceConfig, generateCloudManagerVariables } from "../core/config-generator.js";
import { SEND_AS_KNOWLEDGE, ENTRA_ERRORS, ADOBE_DOCS, MICROSOFT_DOCS } from "../core/knowledge-base.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startServer(port: number): void {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.json());
  app.use(express.static(join(__dirname, "public")));

  // Broadcast to all connected clients
  function broadcast(data: Record<string, unknown>) {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  // GET /api/knowledge — return knowledge base for UI
  app.get("/api/knowledge", (_req, res) => {
    res.json({
      sendAs: SEND_AS_KNOWLEDGE,
      errors: ENTRA_ERRORS,
      adobeDocs: ADOBE_DOCS,
      microsoftDocs: MICROSOFT_DOCS,
    });
  });

  // POST /api/validate — run config validation only
  app.post("/api/validate", (req, res) => {
    const config = req.body as EmailConfig;
    const findings = validateConfig(config);
    res.json({ findings });
    broadcast({ type: "findings", step: CheckStep.VALIDATE_CONFIG, findings });
  });

  // POST /api/oauth/start — begin OAuth2 flow
  app.post("/api/oauth/start", (req, res) => {
    const config = req.body as EmailConfig;
    const { url, state } = buildAuthorizeUrl(config);
    res.json({ url, state });
  });

  // POST /api/oauth/exchange — exchange auth code for tokens
  app.post("/api/oauth/exchange", async (req, res) => {
    const { config, code } = req.body as { config: EmailConfig; code: string };
    const findings: Finding[] = [];

    try {
      const { tokens, finding } = await exchangeCodeForTokens(config, code);
      findings.push(finding);

      if (tokens.refreshToken) {
        findings.push(createFinding({
          id: "REFRESH_TOKEN_PRESENT",
          step: CheckStep.TEST_OAUTH2,
          severity: Severity.PASS,
          title: "Refresh token present",
          detail: `${tokens.refreshToken.length} chars`,
        }));

        try {
          const { tokens: refreshed, finding: refreshFinding } = await refreshAccessToken(config, tokens.refreshToken);
          findings.push(refreshFinding);
          res.json({ tokens: { ...tokens, latestAccessToken: refreshed.accessToken || tokens.accessToken }, findings });
        } catch (refreshErr: unknown) {
          const re = refreshErr as Error & { finding?: Finding };
          if (re.finding) findings.push(re.finding);
          res.json({ tokens, findings });
        }
      } else {
        findings.push(createFinding({
          id: "REFRESH_TOKEN_PRESENT",
          step: CheckStep.TEST_OAUTH2,
          severity: Severity.FAIL,
          title: "No refresh token",
          detail: "offline_access scope may be missing",
        }));
        res.json({ tokens, findings });
      }
    } catch (err: unknown) {
      const e = err as Error & { finding?: Finding };
      if (e.finding) findings.push(e.finding);
      else findings.push(createFinding({
        id: "OAUTH2_CODE_EXCHANGE",
        step: CheckStep.TEST_OAUTH2,
        severity: Severity.FAIL,
        title: "Code exchange failed",
        detail: e.message,
      }));
      res.json({ tokens: null, findings });
    }

    broadcast({ type: "findings", step: CheckStep.TEST_OAUTH2, findings });
  });

  // POST /api/smtp/test — test SMTP connectivity
  app.post("/api/smtp/test", async (req, res) => {
    const { config, accessToken, sendTestEmail } = req.body as {
      config: EmailConfig;
      accessToken: string;
      sendTestEmail?: boolean;
    };
    const { result, findings } = await testSmtp(config, accessToken, { sendTestEmail });
    res.json({ result, findings });
    broadcast({ type: "findings", step: CheckStep.TEST_SMTP, findings });
  });

  // POST /api/oauth/refresh — use existing refresh token to get access token
  app.post("/api/oauth/refresh", async (req, res) => {
    const { config, refreshToken } = req.body as { config: EmailConfig; refreshToken: string };
    const findings: Finding[] = [];

    findings.push(createFinding({
      id: "REFRESH_TOKEN_PRESENT",
      step: CheckStep.TEST_OAUTH2,
      severity: Severity.PASS,
      title: "Refresh token provided",
      detail: `${refreshToken.length} chars (pasted manually)`,
    }));

    try {
      const { tokens, finding } = await refreshAccessToken(config, refreshToken);
      findings.push(finding);
      res.json({
        tokens: { ...tokens, refreshToken, latestAccessToken: tokens.accessToken },
        findings,
      });
    } catch (err: unknown) {
      const e = err as Error & { finding?: Finding };
      if (e.finding) findings.push(e.finding);
      else findings.push(createFinding({
        id: "OAUTH2_REFRESH",
        step: CheckStep.TEST_OAUTH2,
        severity: Severity.FAIL,
        title: "Refresh token exchange failed",
        detail: e.message,
      }));
      res.json({ tokens: null, findings });
    }

    broadcast({ type: "findings", step: CheckStep.TEST_OAUTH2, findings });
  });

  // POST /api/config/generate — generate AEM OSGi configs
  app.post("/api/config/generate", (req, res) => {
    const { config, refreshToken } = req.body as {
      config: EmailConfig;
      refreshToken?: string;
    };
    res.json({
      oauthConfig: generateOAuthConfig(config),
      mailServiceConfig: generateMailServiceConfig(config),
      cmVariables: generateCloudManagerVariables(config, refreshToken),
    });
  });

  // POST /api/scan — run full scan
  app.post("/api/scan", async (req, res) => {
    const config = req.body as EmailConfig;
    const findings: Finding[] = [];
    const tiers = { core: true, cloudManager: false, aem: false, azure: false };

    // Step 2
    findings.push(...validateConfig(config));
    broadcast({ type: "findings", step: CheckStep.VALIDATE_CONFIG, findings: findings.slice() });

    const report = buildReport(findings, tiers);
    res.json(report);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`\nAEM Email Doctor web UI: http://localhost:${port}`);
    console.log("Press Ctrl+C to stop.\n");
  });
}
