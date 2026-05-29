import { describe, it, expect } from "vitest";
import {
  type Finding,
  type EmailConfig,
  type FixAction,
  type DiagnosticReport,
  Severity,
  CheckStep,
  createFinding,
} from "../../src/core/types.js";

describe("core types", () => {
  it("createFinding produces a valid Finding with all fields", () => {
    const finding = createFinding({
      id: "SCOPE_OFFLINE_ACCESS",
      step: CheckStep.VALIDATE_CONFIG,
      severity: Severity.FAIL,
      title: "Scopes missing offline_access",
      detail: "Without offline_access, Microsoft will not return a refresh token.",
      fix: "Add offline_access to the scopes array.",
      docUrl: "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/oauth2-support-for-mail-service",
    });

    expect(finding.id).toBe("SCOPE_OFFLINE_ACCESS");
    expect(finding.step).toBe(CheckStep.VALIDATE_CONFIG);
    expect(finding.severity).toBe(Severity.FAIL);
    expect(finding.title).toBe("Scopes missing offline_access");
    expect(finding.fix).toBeDefined();
    expect(finding.docUrl).toContain("experienceleague.adobe.com");
  });

  it("createFinding defaults optional fields to undefined", () => {
    const finding = createFinding({
      id: "TENANT_ID_FORMAT",
      step: CheckStep.VALIDATE_CONFIG,
      severity: Severity.PASS,
      title: "Tenant ID format valid",
      detail: "Tenant ID is a valid GUID.",
    });

    expect(finding.fix).toBeUndefined();
    expect(finding.fixAction).toBeUndefined();
    expect(finding.evidence).toBeUndefined();
    expect(finding.docUrl).toBeUndefined();
  });

  it("EmailConfig requires all mandatory fields", () => {
    const config: EmailConfig = {
      tenantId: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
      clientId: "11111111-2222-3333-4444-555555555555",
      clientSecret: "test-secret",
      mailbox: "service-account@contoso.com",
      fromAddress: "noreply@contoso.com",
      smtpPort: 30587,
      redirectUri: "http://localhost",
      scopes: [
        "https://outlook.office.com/SMTP.Send",
        "offline_access",
        "openid",
        "email",
        "profile",
      ],
    };

    expect(config.tenantId).toBe("aaaabbbb-cccc-dddd-eeee-ffffffffffff");
    expect(config.scopes).toHaveLength(5);
  });

  it("DiagnosticReport aggregates findings with counts", () => {
    const report: DiagnosticReport = {
      timestamp: new Date().toISOString(),
      findings: [
        createFinding({ id: "A", step: CheckStep.VALIDATE_CONFIG, severity: Severity.PASS, title: "A", detail: "a" }),
        createFinding({ id: "B", step: CheckStep.VALIDATE_CONFIG, severity: Severity.FAIL, title: "B", detail: "b" }),
        createFinding({ id: "C", step: CheckStep.VALIDATE_CONFIG, severity: Severity.WARN, title: "C", detail: "c" }),
        createFinding({ id: "D", step: CheckStep.VALIDATE_CONFIG, severity: Severity.SKIP, title: "D", detail: "d" }),
      ],
      summary: { pass: 1, fail: 1, warn: 1, skip: 1, total: 4 },
      tiers: { core: true, cloudManager: false, aem: false, azure: false },
    };

    expect(report.summary.total).toBe(4);
    expect(report.summary.fail).toBe(1);
  });
});
