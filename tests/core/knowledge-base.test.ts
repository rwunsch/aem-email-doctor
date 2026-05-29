import { describe, it, expect } from "vitest";
import {
  ADOBE_DOCS,
  MICROSOFT_DOCS,
  ENTRA_ERRORS,
  SEND_AS_KNOWLEDGE,
  REQUIRED_SCOPES,
  CRITICAL_SCOPES,
  RECOMMENDED_SCOPES,
} from "../../src/core/knowledge-base.js";

describe("ADOBE_DOCS", () => {
  it("has all required documentation URLs", () => {
    expect(ADOBE_DOCS.OAUTH2_MAIL_SERVICE).toContain("experienceleague.adobe.com");
    expect(ADOBE_DOCS.ADVANCED_NETWORKING).toContain("experienceleague.adobe.com");
    expect(ADOBE_DOCS.CLOUD_MANAGER_ENV_VARS).toContain("experienceleague.adobe.com");
  });

  it("uses the correct AEM CS security path", () => {
    expect(ADOBE_DOCS.OAUTH2_MAIL_SERVICE).toContain(
      "/content/security/oauth2-support-for-mail-service"
    );
  });
});

describe("MICROSOFT_DOCS", () => {
  it("has all required documentation URLs", () => {
    expect(MICROSOFT_DOCS.SMTP_AUTH_OAUTH2).toContain("learn.microsoft.com");
    expect(MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW).toContain("learn.microsoft.com");
    expect(MICROSOFT_DOCS.SMTP_AUTH_ENABLE).toContain("learn.microsoft.com");
    expect(MICROSOFT_DOCS.AADSTS_ERROR_CODES).toContain("learn.microsoft.com");
    expect(MICROSOFT_DOCS.REFRESH_TOKEN_LIFETIME).toContain("learn.microsoft.com");
  });

  it("auth code flow URL points to Entra identity platform", () => {
    expect(MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW).toContain(
      "/entra/identity-platform/v2-oauth2-auth-code-flow"
    );
  });

  it("SMTP auth URL points to Exchange legacy protocols", () => {
    expect(MICROSOFT_DOCS.SMTP_AUTH_OAUTH2).toContain(
      "/exchange/client-developer/legacy-protocols/"
    );
  });
});

describe("ENTRA_ERRORS", () => {
  it("includes the key AADSTS error codes", () => {
    expect(ENTRA_ERRORS).toHaveProperty("AADSTS70008");
    expect(ENTRA_ERRORS).toHaveProperty("AADSTS700082");
    expect(ENTRA_ERRORS).toHaveProperty("AADSTS700016");
    expect(ENTRA_ERRORS).toHaveProperty("AADSTS7000215");
    expect(ENTRA_ERRORS).toHaveProperty("AADSTS65001");
    expect(ENTRA_ERRORS).toHaveProperty("535 5.7.3");
    expect(ENTRA_ERRORS).toHaveProperty("535 5.7.139");
  });

  it("each error has summary, likely_cause, and fix", () => {
    for (const [code, entry] of Object.entries(ENTRA_ERRORS)) {
      expect(entry.summary, `${code} missing summary`).toBeTruthy();
      expect(entry.likely_cause, `${code} missing likely_cause`).toBeTruthy();
      expect(entry.fix, `${code} missing fix`).toBeTruthy();
    }
  });

  it("AADSTS70008 references authorization code expiry", () => {
    expect(ENTRA_ERRORS.AADSTS70008.summary).toContain("expired");
  });

  it("AADSTS700082 references 90-day refresh token expiry", () => {
    expect(ENTRA_ERRORS.AADSTS700082.summary).toContain("90");
  });

  it("535 5.7.139 references SMTP AUTH disabled", () => {
    expect(ENTRA_ERRORS["535 5.7.139"].summary).toContain("disabled");
  });
});

describe("SEND_AS_KNOWLEDGE", () => {
  it("has a summary about Send As / Send on Behalf", () => {
    expect(SEND_AS_KNOWLEDGE.summary).toContain("Send As");
  });

  it("provides at least 3 options", () => {
    expect(SEND_AS_KNOWLEDGE.options.length).toBeGreaterThanOrEqual(3);
  });

  it("each option has name, description, and how", () => {
    for (const opt of SEND_AS_KNOWLEDGE.options) {
      expect(opt.name).toBeTruthy();
      expect(opt.description).toBeTruthy();
      expect(opt.how).toBeTruthy();
    }
  });

  it("includes a Shared Mailbox option", () => {
    const shared = SEND_AS_KNOWLEDGE.options.find(
      (o) => o.name === "Shared Mailbox"
    );
    expect(shared).toBeDefined();
    expect(shared!.powershell).toContain("New-Mailbox");
  });

  it("has a recommendation", () => {
    expect(SEND_AS_KNOWLEDGE.recommendation).toContain("Shared Mailbox");
  });
});

describe("Scopes", () => {
  it("REQUIRED_SCOPES includes SMTP.Send and offline_access", () => {
    expect(REQUIRED_SCOPES).toContain("https://outlook.office.com/SMTP.Send");
    expect(REQUIRED_SCOPES).toContain("offline_access");
  });

  it("CRITICAL_SCOPES is a subset of REQUIRED_SCOPES", () => {
    for (const scope of CRITICAL_SCOPES) {
      expect(REQUIRED_SCOPES).toContain(scope);
    }
  });

  it("SMTP.Send scope uses outlook.office.com (not office365.com)", () => {
    const smtpScope = REQUIRED_SCOPES.find((s) => s.includes("SMTP.Send"));
    expect(smtpScope).toBe("https://outlook.office.com/SMTP.Send");
  });

  it("RECOMMENDED_SCOPES includes openid, email, profile", () => {
    expect(RECOMMENDED_SCOPES).toContain("openid");
    expect(RECOMMENDED_SCOPES).toContain("email");
    expect(RECOMMENDED_SCOPES).toContain("profile");
  });
});
