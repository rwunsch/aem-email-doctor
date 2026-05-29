import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// We test the API routes by importing the server module and hitting endpoints
// with fetch. We mock the core functions to isolate the server logic.

// Mock core modules
vi.mock("../../src/core/config-validator.js", () => ({
  validateConfig: vi.fn(() => [
    {
      id: "TENANT_ID_FORMAT",
      step: 2,
      severity: "pass",
      title: "Tenant ID is valid",
      detail: "OK",
    },
  ]),
}));

vi.mock("../../src/core/oauth.js", () => ({
  buildAuthorizeUrl: vi.fn((config: any) => ({
    url: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize?test=1`,
    state: "mock-state-abc",
  })),
  exchangeCodeForTokens: vi.fn(async () => ({
    tokens: {
      accessToken: "mock-at",
      refreshToken: "mock-rt",
      expiresIn: 3600,
      tokenType: "Bearer",
    },
    finding: {
      id: "OAUTH2_CODE_EXCHANGE",
      step: 3,
      severity: "pass",
      title: "Token exchange succeeded",
      detail: "OK",
    },
  })),
  refreshAccessToken: vi.fn(async () => ({
    tokens: {
      accessToken: "refreshed-at",
      refreshToken: "refreshed-rt",
      expiresIn: 3600,
      tokenType: "Bearer",
    },
    finding: {
      id: "OAUTH2_REFRESH",
      step: 3,
      severity: "pass",
      title: "Refresh succeeded",
      detail: "OK",
    },
  })),
}));

vi.mock("../../src/core/smtp.js", () => ({
  testSmtp: vi.fn(async () => ({
    result: {
      connected: true,
      starttls: true,
      authenticated: true,
      emailSent: false,
      transcript: ["[TCP] Connected"],
    },
    findings: [
      {
        id: "SMTP_CONNECT",
        step: 4,
        severity: "pass",
        title: "SMTP connected",
        detail: "OK",
      },
    ],
  })),
}));

vi.mock("../../src/core/config-generator.js", () => ({
  generateOAuthConfig: vi.fn(() => '{"authUrl":"https://..."}'),
  generateMailServiceConfig: vi.fn(() => '{"smtp.host":"proxy.tunnel"}'),
  generateCloudManagerVariables: vi.fn(() => "# Cloud Manager Variables"),
}));

vi.mock("../../src/core/checklist.js", () => ({
  buildReport: vi.fn((findings: any[], tiers: any) => ({
    timestamp: "2026-01-01T00:00:00.000Z",
    findings,
    summary: { pass: 1, fail: 0, warn: 0, skip: 0, total: 1 },
    tiers,
  })),
}));

// Now import the module under test
const { startServer } = await import("../../src/web/server.js");

let server: Server;
let baseUrl: string;

// Start the server on a random port
beforeAll(async () => {
  // We can't use startServer directly because it binds to a specific port.
  // Instead, we'll replicate the key setup. Let's just use a high random port.
  const port = 19900 + Math.floor(Math.random() * 99);
  await new Promise<void>((resolve) => {
    // Capture console.log to suppress startup message
    const origLog = console.log;
    console.log = () => {};
    startServer(port);
    console.log = origLog;
    // Give it a moment to bind
    setTimeout(() => {
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    }, 300);
  });
});

function makeConfig() {
  return {
    tenantId: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
    clientId: "11111111-2222-3333-4444-555555555555",
    clientSecret: "secret",
    mailbox: "user@example.com",
    fromAddress: "user@example.com",
    smtpPort: 587,
    redirectUri: "http://localhost:8080",
    scopes: ["https://outlook.office.com/SMTP.Send", "offline_access"],
  };
}

describe("GET /api/knowledge", () => {
  it("returns knowledge base data", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("sendAs");
    expect(data).toHaveProperty("errors");
    expect(data).toHaveProperty("adobeDocs");
    expect(data).toHaveProperty("microsoftDocs");
  });
});

describe("POST /api/validate", () => {
  it("returns findings array", async () => {
    const res = await fetch(`${baseUrl}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeConfig()),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("findings");
    expect(Array.isArray(data.findings)).toBe(true);
  });
});

describe("POST /api/oauth/start", () => {
  it("returns authorization URL and state", async () => {
    const res = await fetch(`${baseUrl}/api/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeConfig()),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("url");
    expect(data).toHaveProperty("state");
    expect(data.url).toContain("login.microsoftonline.com");
    expect(data.state).toBe("mock-state-abc");
  });
});

describe("POST /api/oauth/exchange", () => {
  it("returns tokens and findings on success", async () => {
    const res = await fetch(`${baseUrl}/api/oauth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: makeConfig(), code: "auth-code-123" }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("tokens");
    expect(data.tokens.accessToken).toBeTruthy();
    expect(data).toHaveProperty("findings");
    expect(data.findings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /api/oauth/refresh", () => {
  it("returns refreshed tokens and findings", async () => {
    const res = await fetch(`${baseUrl}/api/oauth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: makeConfig(),
        refreshToken: "existing-refresh-token",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.tokens).toBeTruthy();
    expect(data.findings.length).toBeGreaterThanOrEqual(2); // REFRESH_TOKEN_PRESENT + OAUTH2_REFRESH
  });

  it("includes REFRESH_TOKEN_PRESENT finding", async () => {
    const res = await fetch(`${baseUrl}/api/oauth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: makeConfig(),
        refreshToken: "rt-12345",
      }),
    });
    const data = await res.json();
    const rtFinding = data.findings.find(
      (f: any) => f.id === "REFRESH_TOKEN_PRESENT"
    );
    expect(rtFinding).toBeDefined();
    expect(rtFinding.severity).toBe("pass");
  });
});

describe("POST /api/smtp/test", () => {
  it("returns SMTP test result and findings", async () => {
    const res = await fetch(`${baseUrl}/api/smtp/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: makeConfig(),
        accessToken: "at-123",
        sendTestEmail: false,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("result");
    expect(data.result.connected).toBe(true);
    expect(data).toHaveProperty("findings");
  });
});

describe("POST /api/config/generate", () => {
  it("returns generated config strings", async () => {
    const res = await fetch(`${baseUrl}/api/config/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: makeConfig(),
        refreshToken: "rt-gen-test",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("oauthConfig");
    expect(data).toHaveProperty("mailServiceConfig");
    expect(data).toHaveProperty("cmVariables");
  });
});

describe("POST /api/scan", () => {
  it("returns a diagnostic report", async () => {
    const res = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeConfig()),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("findings");
    expect(data).toHaveProperty("summary");
    expect(data).toHaveProperty("tiers");
  });
});
