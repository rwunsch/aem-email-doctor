import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/core/config-validator.js";
import { EmailConfig, Severity } from "../../src/core/types.js";

function makeConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    tenantId: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
    clientId: "11111111-2222-3333-4444-555555555555",
    clientSecret: "test-secret-value",
    mailbox: "service-account@contoso.com",
    fromAddress: "service-account@contoso.com",
    smtpPort: 30587,
    redirectUri: "http://localhost",
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

describe("validateConfig", () => {
  describe("TENANT_ID_FORMAT", () => {
    it("fails for a non-GUID tenant ID", () => {
      const findings = validateConfig(makeConfig({ tenantId: "not-a-guid" }));
      const f = findings.find((x) => x.id === "TENANT_ID_FORMAT");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.FAIL);
    });

    it("passes for a valid GUID tenant ID", () => {
      const findings = validateConfig(makeConfig());
      const f = findings.find((x) => x.id === "TENANT_ID_FORMAT");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("CLIENT_ID_FORMAT", () => {
    it("fails for a non-GUID client ID", () => {
      const findings = validateConfig(makeConfig({ clientId: "bad-client" }));
      const f = findings.find((x) => x.id === "CLIENT_ID_FORMAT");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.FAIL);
    });

    it("passes for a valid GUID client ID", () => {
      const findings = validateConfig(makeConfig());
      const f = findings.find((x) => x.id === "CLIENT_ID_FORMAT");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("SCOPE_OFFLINE_ACCESS", () => {
    it("fails when offline_access is missing from scopes", () => {
      const findings = validateConfig(
        makeConfig({
          scopes: ["https://outlook.office.com/SMTP.Send", "openid", "email", "profile"],
        })
      );
      const f = findings.find((x) => x.id === "SCOPE_OFFLINE_ACCESS");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.FAIL);
      expect(f!.fixAction).toBeDefined();
      expect(f!.fixAction!.type).toBe("generate-config");
    });

    it("passes when offline_access is present", () => {
      const findings = validateConfig(makeConfig());
      const f = findings.find((x) => x.id === "SCOPE_OFFLINE_ACCESS");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("SCOPE_SMTP_SEND", () => {
    it("fails when SMTP.Send scope is missing", () => {
      const findings = validateConfig(
        makeConfig({
          scopes: ["offline_access", "openid", "email", "profile"],
        })
      );
      const f = findings.find((x) => x.id === "SCOPE_SMTP_SEND");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.FAIL);
    });

    it("passes when SMTP.Send is present (case-insensitive)", () => {
      const findings = validateConfig(makeConfig());
      const f = findings.find((x) => x.id === "SCOPE_SMTP_SEND");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("SCOPE_COMPLETENESS", () => {
    it("warns when recommended scopes (openid/email/profile) are missing", () => {
      const findings = validateConfig(
        makeConfig({
          scopes: ["https://outlook.office.com/SMTP.Send", "offline_access"],
        })
      );
      const f = findings.find((x) => x.id === "SCOPE_COMPLETENESS");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.WARN);
    });

    it("passes when all recommended scopes are present", () => {
      const findings = validateConfig(makeConfig());
      const f = findings.find((x) => x.id === "SCOPE_COMPLETENESS");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("REDIRECT_URI_FORMAT", () => {
    it("warns for a non-localhost redirect URI", () => {
      const findings = validateConfig(
        makeConfig({ redirectUri: "https://example.com/callback" })
      );
      const f = findings.find((x) => x.id === "REDIRECT_URI_FORMAT");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.WARN);
    });

    it("passes for http://localhost", () => {
      const findings = validateConfig(makeConfig({ redirectUri: "http://localhost" }));
      const f = findings.find((x) => x.id === "REDIRECT_URI_FORMAT");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });

    it("passes for localhost with a port (http://localhost:8080)", () => {
      const findings = validateConfig(
        makeConfig({ redirectUri: "http://localhost:8080" })
      );
      const f = findings.find((x) => x.id === "REDIRECT_URI_FORMAT");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("FROM_MATCHES_USER", () => {
    it("warns when fromAddress differs from mailbox", () => {
      const findings = validateConfig(
        makeConfig({
          mailbox: "service-account@contoso.com",
          fromAddress: "noreply@contoso.com",
        })
      );
      const f = findings.find((x) => x.id === "FROM_MATCHES_USER");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.WARN);
      expect(f!.detail).toContain("Send As");
      expect(f!.msDocUrl).toBeDefined();
    });

    it("passes when fromAddress matches mailbox (case-insensitive)", () => {
      const findings = validateConfig(
        makeConfig({
          mailbox: "service-account@contoso.com",
          fromAddress: "service-account@contoso.com",
        })
      );
      const f = findings.find((x) => x.id === "FROM_MATCHES_USER");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("SMTP_PORT_RANGE", () => {
    it("fails for standard port 587", () => {
      const findings = validateConfig(makeConfig({ smtpPort: 587 }));
      const f = findings.find((x) => x.id === "SMTP_PORT_RANGE");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.FAIL);
    });

    it("fails for standard port 465", () => {
      const findings = validateConfig(makeConfig({ smtpPort: 465 }));
      const f = findings.find((x) => x.id === "SMTP_PORT_RANGE");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.FAIL);
    });

    it("passes for AEM CS advanced networking port 30587", () => {
      const findings = validateConfig(makeConfig({ smtpPort: 30587 }));
      const f = findings.find((x) => x.id === "SMTP_PORT_RANGE");
      expect(f).toBeDefined();
      expect(f!.severity).toBe(Severity.PASS);
    });
  });

  describe("complete valid config", () => {
    it("returns exactly 8 findings with 0 failures", () => {
      const findings = validateConfig(makeConfig());
      expect(findings).toHaveLength(8);
      const failures = findings.filter((f) => f.severity === Severity.FAIL);
      expect(failures).toHaveLength(0);
    });
  });
});
