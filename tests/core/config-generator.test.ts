import { describe, it, expect } from "vitest";
import {
  generateOAuthConfig,
  generateMailServiceConfig,
  generateCloudManagerVariables,
} from "../../src/core/config-generator.js";
import type { EmailConfig } from "../../src/core/types.js";

const config: EmailConfig = {
  tenantId: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
  clientId: "11111111-2222-3333-4444-555555555555",
  clientSecret: "super-secret",
  mailbox: "noreply@contoso.com",
  fromAddress: "noreply@contoso.com",
  smtpPort: 30587,
  redirectUri: "http://localhost:8080",
  scopes: ["https://outlook.office.com/SMTP.Send", "offline_access", "openid", "email", "profile"],
};

describe("generateOAuthConfig", () => {
  it("produces valid JSON", () => {
    const json = generateOAuthConfig(config);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("uses secret placeholders for client secret and refresh token", () => {
    const json = generateOAuthConfig(config);
    expect(json).toContain("$[secret:SECRET_SMTP_OAUTH_CLIENT_SECRET]");
    expect(json).toContain("$[secret:SECRET_SMTP_OAUTH_REFRESH_TOKEN]");
    expect(json).not.toContain("super-secret");
  });

  it("includes tenant-specific auth, token, and refresh URLs", () => {
    const json = generateOAuthConfig(config);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const tenantId = config.tenantId;
    expect(String(parsed.authUrl ?? parsed["authorizationUrl"] ?? "")).toContain(tenantId);
    expect(String(parsed.tokenUrl ?? "")).toContain(tenantId);
    expect(String(parsed.refreshUrl ?? "")).toContain(tenantId);
  });

  it("includes clientId and scopes", () => {
    const json = generateOAuthConfig(config);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.clientId).toBe(config.clientId);
    // scopes as space-separated string or array
    const scopesStr = JSON.stringify(parsed);
    expect(scopesStr).toContain("SMTP.Send");
    expect(scopesStr).toContain("offline_access");
  });

  it("includes authCodeRedirectUrl", () => {
    const json = generateOAuthConfig(config);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.authCodeRedirectUrl ?? parsed.redirectUri).toBe(config.redirectUri);
  });
});

describe("generateMailServiceConfig", () => {
  it("produces valid JSON", () => {
    const json = generateMailServiceConfig(config);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("uses AEM_PROXY_HOST env placeholder for smtp.host", () => {
    const json = generateMailServiceConfig(config);
    expect(json).toContain("$[env:AEM_PROXY_HOST;default=proxy.tunnel]");
  });

  it("sets smtp.user, smtp.port, from.address correctly", () => {
    const json = generateMailServiceConfig(config);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["smtp.user"]).toBe(config.mailbox);
    expect(parsed["smtp.port"]).toBe(config.smtpPort);
    expect(parsed["from.address"]).toBe(config.fromAddress);
  });

  it("sets smtp.ssl=false, smtp.starttls=true, oauth.flow=true", () => {
    const json = generateMailServiceConfig(config);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["smtp.ssl"]).toBe(false);
    expect(parsed["smtp.starttls"]).toBe(true);
    expect(parsed["oauth.flow"]).toBe(true);
  });
});

describe("generateCloudManagerVariables", () => {
  it("includes variable names in output", () => {
    const output = generateCloudManagerVariables(config);
    expect(output).toContain("SECRET_SMTP_OAUTH_CLIENT_SECRET");
    expect(output).toContain("SECRET_SMTP_OAUTH_REFRESH_TOKEN");
  });

  it("includes aio CLI command hints", () => {
    const output = generateCloudManagerVariables(config);
    expect(output).toContain("aio");
  });

  it("includes refresh token value when provided", () => {
    const output = generateCloudManagerVariables(config, "my-refresh-token");
    expect(output).toContain("my-refresh-token");
  });
});
