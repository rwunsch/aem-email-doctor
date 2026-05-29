import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureAuthCode,
  exchangeCodeForTokens,
  refreshAccessToken,
} from "../../src/core/oauth.js";
import { EmailConfig } from "../../src/core/types.js";
import http from "node:http";

function makeConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    tenantId: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
    clientId: "11111111-2222-3333-4444-555555555555",
    clientSecret: "test-secret-value",
    mailbox: "service-account@contoso.com",
    fromAddress: "service-account@contoso.com",
    smtpPort: 30587,
    redirectUri: "http://localhost:19876",
    scopes: [
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "email",
      "profile",
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// captureAuthCode
// ---------------------------------------------------------------------------

describe("captureAuthCode", () => {
  it("captures auth code from redirect with correct state", async () => {
    const state = "expected-state-123";
    const capturePromise = captureAuthCode("http://localhost:19876", state, {
      timeoutMs: 5000,
    });

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 100));

    // Simulate the redirect callback
    await fetch(
      `http://127.0.0.1:19876/?code=my-auth-code-abc&state=${state}`
    );

    const code = await capturePromise;
    expect(code).toBe("my-auth-code-abc");
  });

  it("rejects on state mismatch (CSRF check)", async () => {
    const capturePromise = captureAuthCode(
      "http://localhost:19877",
      "expected-state",
      { timeoutMs: 5000 }
    );

    await new Promise((r) => setTimeout(r, 100));

    // Fire the request and immediately await the rejection
    const fetchDone = fetch(
      `http://127.0.0.1:19877/?code=some-code&state=wrong-state`
    ).catch(() => {});

    await expect(capturePromise).rejects.toThrow(/[Ss]tate mismatch/);
    await fetchDone;
  });

  it("rejects when no code is in the redirect URL", async () => {
    const capturePromise = captureAuthCode(
      "http://localhost:19878",
      "some-state",
      { timeoutMs: 5000 }
    );

    await new Promise((r) => setTimeout(r, 100));

    const fetchDone = fetch(`http://127.0.0.1:19878/?state=some-state`).catch(() => {});

    await expect(capturePromise).rejects.toThrow(/[Nn]o authorization code/);
    await fetchDone;
  });

  it("rejects when error parameter is present", async () => {
    const capturePromise = captureAuthCode(
      "http://localhost:19879",
      "some-state",
      { timeoutMs: 5000 }
    );

    await new Promise((r) => setTimeout(r, 100));

    const fetchDone = fetch(
      `http://127.0.0.1:19879/?error=access_denied&error_description=User+denied+access`
    ).catch(() => {});

    await expect(capturePromise).rejects.toThrow(/access_denied/);
    await fetchDone;
  });

  it("times out when no redirect is received", async () => {
    const capturePromise = captureAuthCode(
      "http://localhost:19880",
      "state",
      { timeoutMs: 200 }
    );

    await expect(capturePromise).rejects.toThrow(/[Tt]imed out/);
  });

  it("extracts port from redirect URI", async () => {
    const state = "port-test-state";
    const capturePromise = captureAuthCode(
      "http://localhost:19881",
      state,
      { timeoutMs: 5000 }
    );

    await new Promise((r) => setTimeout(r, 100));

    await fetch(`http://127.0.0.1:19881/?code=port-code&state=${state}`);

    const code = await capturePromise;
    expect(code).toBe("port-code");
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens (mocked fetch)
// ---------------------------------------------------------------------------

describe("exchangeCodeForTokens", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns tokens and a PASS finding on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "at-123",
          refresh_token: "rt-456",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://outlook.office.com/SMTP.Send offline_access",
        }),
    }) as unknown as typeof fetch;

    const { tokens, finding } = await exchangeCodeForTokens(
      makeConfig(),
      "auth-code-xyz"
    );

    expect(tokens.accessToken).toBe("at-123");
    expect(tokens.refreshToken).toBe("rt-456");
    expect(tokens.expiresIn).toBe(3600);
    expect(finding.severity).toBe("pass");
    expect(finding.id).toBe("OAUTH2_CODE_EXCHANGE");
  });

  it("sends correct request parameters", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedBody = opts?.body as string;
      capturedHeaders = Object.fromEntries(
        Object.entries(opts?.headers ?? {})
      );
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            token_type: "Bearer",
          }),
      };
    }) as unknown as typeof fetch;

    const config = makeConfig();
    await exchangeCodeForTokens(config, "my-code");

    expect(capturedUrl).toContain(config.tenantId);
    expect(capturedUrl).toContain("/oauth2/v2.0/token");
    expect(capturedHeaders["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    const params = new URLSearchParams(capturedBody);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("my-code");
    expect(params.get("client_id")).toBe(config.clientId);
    expect(params.get("client_secret")).toBe(config.clientSecret);
    expect(params.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("throws with FAIL finding on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error: "invalid_grant",
          error_description:
            "AADSTS70008: The provided authorization code or refresh token has expired.",
          error_codes: [70008],
        }),
    }) as unknown as typeof fetch;

    try {
      await exchangeCodeForTokens(makeConfig(), "expired-code");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { finding?: { severity: string; id: string } };
      expect(e.finding).toBeDefined();
      expect(e.finding!.severity).toBe("fail");
      expect(e.finding!.id).toBe("OAUTH2_CODE_EXCHANGE");
    }
  });

  it("matches AADSTS error codes to knowledge base", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error: "invalid_client",
          error_description: "AADSTS7000215: Invalid client secret provided.",
          error_codes: [7000215],
        }),
    }) as unknown as typeof fetch;

    try {
      await exchangeCodeForTokens(makeConfig(), "code");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { finding?: { detail: string; fix?: string } };
      expect(e.finding!.detail).toContain("Invalid client secret");
      expect(e.finding!.fix).toBeTruthy();
    }
  });

  it("handles network errors with FAIL finding", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new Error("fetch failed")
      ) as unknown as typeof fetch;

    try {
      await exchangeCodeForTokens(makeConfig(), "code");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { finding?: { severity: string } };
      expect(e.finding).toBeDefined();
      expect(e.finding!.severity).toBe("fail");
    }
  });

  it("throws when response is missing refresh_token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "at-only",
          expires_in: 3600,
          token_type: "Bearer",
        }),
    }) as unknown as typeof fetch;

    try {
      await exchangeCodeForTokens(makeConfig(), "code");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error;
      expect(e.message).toContain("refresh_token");
    }
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken (mocked fetch)
// ---------------------------------------------------------------------------

describe("refreshAccessToken", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns refreshed tokens and PASS finding on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-at-789",
          refresh_token: "new-rt-012",
          expires_in: 3600,
          token_type: "Bearer",
        }),
    }) as unknown as typeof fetch;

    const { tokens, finding } = await refreshAccessToken(
      makeConfig(),
      "old-refresh-token"
    );

    expect(tokens.accessToken).toBe("new-at-789");
    expect(finding.severity).toBe("pass");
    expect(finding.id).toBe("OAUTH2_REFRESH");
  });

  it("sends correct refresh request parameters", async () => {
    let capturedBody = "";

    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body as string;
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            token_type: "Bearer",
          }),
      };
    }) as unknown as typeof fetch;

    await refreshAccessToken(makeConfig(), "my-refresh-token");

    const params = new URLSearchParams(capturedBody);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("my-refresh-token");
  });

  it("throws with FAIL finding on expired refresh token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error: "invalid_grant",
          error_description:
            "AADSTS700082: The refresh token has expired due to inactivity.",
        }),
    }) as unknown as typeof fetch;

    try {
      await refreshAccessToken(makeConfig(), "expired-rt");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { finding?: { severity: string; detail: string } };
      expect(e.finding!.severity).toBe("fail");
      expect(e.finding!.detail).toContain("expired");
    }
  });

  it("handles network errors with FAIL finding", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    try {
      await refreshAccessToken(makeConfig(), "rt");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const e = err as Error & { finding?: { severity: string; title: string } };
      expect(e.finding).toBeDefined();
      expect(e.finding!.severity).toBe("fail");
      expect(e.finding!.title).toContain("network error");
    }
  });
});
