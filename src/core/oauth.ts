import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EmailConfig, TokenResult, Finding, Severity, CheckStep, createFinding } from "./types.js";
import { MICROSOFT_DOCS, ENTRA_ERRORS } from "./knowledge-base.js";

const AUTHORIZE_BASE = "https://login.microsoftonline.com";

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

export function getTokenUrl(tenantId: string): string {
  return `${AUTHORIZE_BASE}/${tenantId}/oauth2/v2.0/token`;
}

export function buildAuthorizeUrl(config: EmailConfig): { url: string; state: string } {
  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
  });
  const url = `${AUTHORIZE_BASE}/${config.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  return { url, state };
}

// ---------------------------------------------------------------------------
// Token request bodies
// ---------------------------------------------------------------------------

export function buildTokenRequestBody(config: EmailConfig, authCode: string): string {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: authCode,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
  });
  return params.toString();
}

export function buildRefreshRequestBody(config: EmailConfig, refreshToken: string): string {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scopes.join(" "),
  });
  return params.toString();
}

// ---------------------------------------------------------------------------
// Token response parsing
// ---------------------------------------------------------------------------

export function parseTokenResponse(body: Record<string, unknown>): TokenResult {
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Token response missing access_token");
  }
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    throw new Error(
      "Token response missing refresh_token. Ensure offline_access scope is requested."
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    scope: typeof body.scope === "string" ? body.scope : undefined,
  };
}

// ---------------------------------------------------------------------------
// XOAUTH2 token
// ---------------------------------------------------------------------------

export function buildXOAuth2Token(user: string, accessToken: string): string {
  const raw = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(raw, "utf8").toString("base64");
}

// ---------------------------------------------------------------------------
// Authorization code capture (local redirect server)
// ---------------------------------------------------------------------------

export interface CaptureOptions {
  timeoutMs?: number;
}

export async function captureAuthCode(
  redirectUri: string,
  expectedState: string,
  options: CaptureOptions = {}
): Promise<string> {
  const { timeoutMs = 5 * 60 * 1000 } = options;

  const parsed = new URL(redirectUri);
  const port = parsed.port ? parseInt(parsed.port, 10) : 80;

  return new Promise<string>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const reqUrl = new URL(req.url ?? "/", redirectUri);
        const code = reqUrl.searchParams.get("code");
        const state = reqUrl.searchParams.get("state");
        const error = reqUrl.searchParams.get("error");
        const errorDescription = reqUrl.searchParams.get("error_description");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            `<h1>Authorization Error</h1><p>${error}: ${errorDescription ?? ""}</p><p>You may close this tab.</p>`
          );
          server.close();
          reject(new Error(`Authorization failed: ${error} — ${errorDescription ?? ""}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Missing authorization code</h1><p>You may close this tab.</p>");
          server.close();
          reject(new Error("No authorization code in redirect URL"));
          return;
        }

        // CSRF check
        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>State mismatch (CSRF check failed)</h1><p>You may close this tab.</p>");
          server.close();
          reject(new Error(`State mismatch: expected ${expectedState}, got ${state}`));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You may close this tab and return to the terminal.</p>"
        );
        server.close();
        resolve(code);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`Timed out waiting for authorization code after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    server.listen(port, "127.0.0.1", () => {
      // Server is listening
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    server.on("close", () => {
      clearTimeout(timer);
    });
  });
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeCodeForTokens(
  config: EmailConfig,
  authCode: string
): Promise<{ tokens: TokenResult; finding: Finding }> {
  const tokenUrl = getTokenUrl(config.tenantId);
  const body = buildTokenRequestBody(config, authCode);

  let rawBody: Record<string, unknown>;
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    rawBody = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errorCode = typeof rawBody.error_codes === "object" && Array.isArray(rawBody.error_codes)
        ? String(rawBody.error_codes[0])
        : undefined;
      const errorMsg = typeof rawBody.error_description === "string"
        ? rawBody.error_description
        : String(rawBody.error ?? "Unknown error");

      // Try to match AADSTS error code
      const aadCode = errorMsg.match(/AADSTS\d+/)?.[0];
      const knowledge = aadCode ? ENTRA_ERRORS[aadCode] : undefined;

      const finding = createFinding({
        id: "OAUTH2_CODE_EXCHANGE",
        step: CheckStep.TEST_OAUTH2,
        severity: Severity.FAIL,
        title: "Token exchange failed",
        detail: knowledge
          ? `${knowledge.summary} ${knowledge.likely_cause}`
          : errorMsg,
        fix: knowledge?.fix,
        evidence: errorMsg,
        docUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
        msDocUrl: MICROSOFT_DOCS.AADSTS_ERROR_CODES,
      });
      throw Object.assign(new Error(errorMsg), { finding, errorCode });
    }
  } catch (err: unknown) {
    const e = err as Error & { finding?: Finding };
    if (e.finding) throw e;
    const finding = createFinding({
      id: "OAUTH2_CODE_EXCHANGE",
      step: CheckStep.TEST_OAUTH2,
      severity: Severity.FAIL,
      title: "Token exchange network error",
      detail: e.message,
      docUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
    });
    throw Object.assign(e, { finding });
  }

  const tokens = parseTokenResponse(rawBody);
  const finding = createFinding({
    id: "OAUTH2_CODE_EXCHANGE",
    step: CheckStep.TEST_OAUTH2,
    severity: Severity.PASS,
    title: "Authorization code exchanged successfully",
    detail: `Obtained access_token and refresh_token. Token expires in ${tokens.expiresIn}s.`,
    docUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
  });
  return { tokens, finding };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  config: EmailConfig,
  refreshToken: string
): Promise<{ tokens: TokenResult; finding: Finding }> {
  const tokenUrl = getTokenUrl(config.tenantId);
  const body = buildRefreshRequestBody(config, refreshToken);

  let rawBody: Record<string, unknown>;
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    rawBody = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errorMsg = typeof rawBody.error_description === "string"
        ? rawBody.error_description
        : String(rawBody.error ?? "Unknown error");

      const aadCode = errorMsg.match(/AADSTS\d+/)?.[0];
      const knowledge = aadCode ? ENTRA_ERRORS[aadCode] : undefined;

      const finding = createFinding({
        id: "OAUTH2_REFRESH",
        step: CheckStep.TEST_OAUTH2,
        severity: Severity.FAIL,
        title: "Token refresh failed",
        detail: knowledge
          ? `${knowledge.summary} ${knowledge.likely_cause}`
          : errorMsg,
        fix: knowledge?.fix,
        evidence: errorMsg,
        docUrl: MICROSOFT_DOCS.REFRESH_TOKEN_LIFETIME,
        msDocUrl: MICROSOFT_DOCS.AADSTS_ERROR_CODES,
      });
      throw Object.assign(new Error(errorMsg), { finding });
    }
  } catch (err: unknown) {
    const e = err as Error & { finding?: Finding };
    if (e.finding) throw e;
    const finding = createFinding({
      id: "OAUTH2_REFRESH",
      step: CheckStep.TEST_OAUTH2,
      severity: Severity.FAIL,
      title: "Token refresh network error",
      detail: e.message,
      docUrl: MICROSOFT_DOCS.REFRESH_TOKEN_LIFETIME,
    });
    throw Object.assign(e, { finding });
  }

  const tokens = parseTokenResponse(rawBody);
  const finding = createFinding({
    id: "OAUTH2_REFRESH",
    step: CheckStep.TEST_OAUTH2,
    severity: Severity.PASS,
    title: "Refresh token accepted — new access token obtained",
    detail: `New access_token obtained. Expires in ${tokens.expiresIn}s.`,
    docUrl: MICROSOFT_DOCS.REFRESH_TOKEN_LIFETIME,
  });
  return { tokens, finding };
}
