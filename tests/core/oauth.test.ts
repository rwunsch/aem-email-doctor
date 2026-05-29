import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  buildTokenRequestBody,
  buildRefreshRequestBody,
  parseTokenResponse,
  buildXOAuth2Token,
  getTokenUrl,
} from "../../src/core/oauth.js";
import { EmailConfig } from "../../src/core/types.js";

function makeConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    tenantId: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
    clientId: "11111111-2222-3333-4444-555555555555",
    clientSecret: "test-secret-value",
    mailbox: "service-account@contoso.com",
    fromAddress: "service-account@contoso.com",
    smtpPort: 30587,
    redirectUri: "http://localhost:8080",
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

describe("buildAuthorizeUrl", () => {
  it("returns an object with url and state properties", () => {
    const result = buildAuthorizeUrl(makeConfig());
    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("state");
    expect(typeof result.url).toBe("string");
    expect(typeof result.state).toBe("string");
  });

  it("includes the correct tenant ID in the URL path", () => {
    const config = makeConfig();
    const { url } = buildAuthorizeUrl(config);
    expect(url).toContain(`/aaaabbbb-cccc-dddd-eeee-ffffffffffff/`);
  });

  it("uses the Microsoft authorize endpoint", () => {
    const { url } = buildAuthorizeUrl(makeConfig());
    expect(url).toContain("https://login.microsoftonline.com");
    expect(url).toContain("/oauth2/v2.0/authorize");
  });

  it("includes client_id param", () => {
    const config = makeConfig();
    const { url } = buildAuthorizeUrl(config);
    expect(url).toContain("client_id=11111111-2222-3333-4444-555555555555");
  });

  it("includes response_type=code", () => {
    const { url } = buildAuthorizeUrl(makeConfig());
    expect(url).toContain("response_type=code");
  });

  it("includes redirect_uri in the URL", () => {
    const { url } = buildAuthorizeUrl(makeConfig());
    expect(url).toContain("redirect_uri=");
  });

  it("includes scope param", () => {
    const { url } = buildAuthorizeUrl(makeConfig());
    expect(url).toContain("scope=");
    expect(url).toContain("SMTP.Send");
  });

  it("includes state param matching the returned state", () => {
    const { url, state } = buildAuthorizeUrl(makeConfig());
    expect(url).toContain(`state=${state}`);
  });

  it("generates unique state values on each call", () => {
    const r1 = buildAuthorizeUrl(makeConfig());
    const r2 = buildAuthorizeUrl(makeConfig());
    expect(r1.state).not.toBe(r2.state);
  });
});

describe("getTokenUrl", () => {
  it("returns the correct Microsoft token URL for a given tenant", () => {
    const url = getTokenUrl("aaaabbbb-cccc-dddd-eeee-ffffffffffff");
    expect(url).toBe(
      "https://login.microsoftonline.com/aaaabbbb-cccc-dddd-eeee-ffffffffffff/oauth2/v2.0/token"
    );
  });
});

describe("buildTokenRequestBody", () => {
  it("returns a URL-encoded string", () => {
    const body = buildTokenRequestBody(makeConfig(), "auth-code-123");
    expect(typeof body).toBe("string");
  });

  it("includes grant_type=authorization_code", () => {
    const body = buildTokenRequestBody(makeConfig(), "auth-code-123");
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("authorization_code");
  });

  it("includes the provided auth code", () => {
    const body = buildTokenRequestBody(makeConfig(), "my-special-code");
    const params = new URLSearchParams(body);
    expect(params.get("code")).toBe("my-special-code");
  });

  it("includes client_id from config", () => {
    const body = buildTokenRequestBody(makeConfig(), "code");
    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("includes client_secret from config", () => {
    const body = buildTokenRequestBody(makeConfig(), "code");
    const params = new URLSearchParams(body);
    expect(params.get("client_secret")).toBe("test-secret-value");
  });

  it("includes redirect_uri from config", () => {
    const body = buildTokenRequestBody(makeConfig(), "code");
    const params = new URLSearchParams(body);
    expect(params.get("redirect_uri")).toBe("http://localhost:8080");
  });

  it("includes scope from config", () => {
    const body = buildTokenRequestBody(makeConfig(), "code");
    const params = new URLSearchParams(body);
    expect(params.get("scope")).toBeTruthy();
    expect(params.get("scope")).toContain("SMTP.Send");
  });
});

describe("buildRefreshRequestBody", () => {
  it("returns a URL-encoded string", () => {
    const body = buildRefreshRequestBody(makeConfig(), "refresh-token-abc");
    expect(typeof body).toBe("string");
  });

  it("includes grant_type=refresh_token", () => {
    const body = buildRefreshRequestBody(makeConfig(), "refresh-token-abc");
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("refresh_token");
  });

  it("includes the provided refresh token", () => {
    const body = buildRefreshRequestBody(makeConfig(), "my-refresh-token");
    const params = new URLSearchParams(body);
    expect(params.get("refresh_token")).toBe("my-refresh-token");
  });

  it("includes client_id and client_secret", () => {
    const body = buildRefreshRequestBody(makeConfig(), "rt");
    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe("11111111-2222-3333-4444-555555555555");
    expect(params.get("client_secret")).toBe("test-secret-value");
  });

  it("includes scope", () => {
    const body = buildRefreshRequestBody(makeConfig(), "rt");
    const params = new URLSearchParams(body);
    expect(params.get("scope")).toBeTruthy();
  });
});

describe("parseTokenResponse", () => {
  const validResponse = {
    access_token: "eyJhbGciOiJSUzI1Ni...",
    refresh_token: "0.ARoAImk...",
    expires_in: 3599,
    token_type: "Bearer",
    scope: "https://outlook.office.com/SMTP.Send offline_access openid email profile",
  };

  it("extracts access_token from the response", () => {
    const result = parseTokenResponse(validResponse);
    expect(result.accessToken).toBe("eyJhbGciOiJSUzI1Ni...");
  });

  it("extracts refresh_token from the response", () => {
    const result = parseTokenResponse(validResponse);
    expect(result.refreshToken).toBe("0.ARoAImk...");
  });

  it("extracts expires_in", () => {
    const result = parseTokenResponse(validResponse);
    expect(result.expiresIn).toBe(3599);
  });

  it("extracts token_type", () => {
    const result = parseTokenResponse(validResponse);
    expect(result.tokenType).toBe("Bearer");
  });

  it("extracts scope when present", () => {
    const result = parseTokenResponse(validResponse);
    expect(result.scope).toContain("SMTP.Send");
  });

  it("throws when access_token is missing", () => {
    const bad = { ...validResponse, access_token: undefined };
    expect(() => parseTokenResponse(bad as Record<string, unknown>)).toThrow();
  });

  it("throws when refresh_token is missing", () => {
    const bad = { ...validResponse, refresh_token: undefined };
    expect(() => parseTokenResponse(bad as Record<string, unknown>)).toThrow();
  });

  it("throws when response is empty", () => {
    expect(() => parseTokenResponse({})).toThrow();
  });
});

describe("buildXOAuth2Token", () => {
  it("returns a base64-encoded string", () => {
    const token = buildXOAuth2Token("user@example.com", "access-token-123");
    // Should be valid base64
    expect(() => Buffer.from(token, "base64").toString("utf8")).not.toThrow();
  });

  it("decodes to correct XOAUTH2 format", () => {
    const token = buildXOAuth2Token("user@example.com", "access-token-123");
    const decoded = Buffer.from(token, "base64").toString("utf8");
    expect(decoded).toBe("user=user@example.com\x01auth=Bearer access-token-123\x01\x01");
  });

  it("includes the user email in the token", () => {
    const token = buildXOAuth2Token("test@example.com", "tok");
    const decoded = Buffer.from(token, "base64").toString("utf8");
    expect(decoded).toContain("test@example.com");
  });

  it("includes the access token with Bearer prefix", () => {
    const token = buildXOAuth2Token("u@x.com", "my-access-token");
    const decoded = Buffer.from(token, "base64").toString("utf8");
    expect(decoded).toContain("Bearer my-access-token");
  });
});
