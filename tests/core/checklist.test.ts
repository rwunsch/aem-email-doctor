import { describe, it, expect } from "vitest";
import { computeSummary, buildReport } from "../../src/core/checklist.js";
import { Severity, CheckStep, createFinding, type Finding, type ProviderStatus } from "../../src/core/types.js";

function makeFinding(id: string, severity: Severity): Finding {
  return createFinding({
    id,
    step: CheckStep.VALIDATE_CONFIG,
    severity,
    title: `Finding ${id}`,
    detail: `Detail for ${id}`,
  });
}

const tiers: ProviderStatus = {
  core: true,
  cloudManager: false,
  aem: false,
  azure: false,
};

describe("computeSummary", () => {
  it("counts pass/fail/warn/skip correctly", () => {
    const findings: Finding[] = [
      makeFinding("A", Severity.PASS),
      makeFinding("B", Severity.PASS),
      makeFinding("C", Severity.FAIL),
      makeFinding("D", Severity.WARN),
      makeFinding("E", Severity.SKIP),
    ];
    const summary = computeSummary(findings);
    expect(summary.pass).toBe(2);
    expect(summary.fail).toBe(1);
    expect(summary.warn).toBe(1);
    expect(summary.skip).toBe(1);
    expect(summary.total).toBe(5);
  });

  it("handles empty findings array", () => {
    const summary = computeSummary([]);
    expect(summary.pass).toBe(0);
    expect(summary.fail).toBe(0);
    expect(summary.warn).toBe(0);
    expect(summary.skip).toBe(0);
    expect(summary.total).toBe(0);
  });

  it("handles all failures", () => {
    const findings = [
      makeFinding("A", Severity.FAIL),
      makeFinding("B", Severity.FAIL),
    ];
    const summary = computeSummary(findings);
    expect(summary.fail).toBe(2);
    expect(summary.pass).toBe(0);
    expect(summary.total).toBe(2);
  });
});

describe("buildReport", () => {
  it("wraps findings with timestamp, summary, and tiers", () => {
    const findings: Finding[] = [
      makeFinding("A", Severity.PASS),
      makeFinding("B", Severity.FAIL),
      makeFinding("C", Severity.WARN),
    ];

    const report = buildReport(findings, tiers);

    expect(report.findings).toBe(findings);
    expect(report.tiers).toBe(tiers);
    expect(report.summary.pass).toBe(1);
    expect(report.summary.fail).toBe(1);
    expect(report.summary.warn).toBe(1);
    expect(report.summary.skip).toBe(0);
    expect(report.summary.total).toBe(3);
    expect(report.timestamp).toBeTruthy();
    // Timestamp should be a valid ISO string
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(new Date(report.timestamp).getFullYear()).toBeGreaterThan(2020);
  });

  it("includes tokenResult when provided", () => {
    const findings: Finding[] = [makeFinding("A", Severity.PASS)];
    const tokenResult = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      tokenType: "Bearer",
    };

    const report = buildReport(findings, tiers, tokenResult);
    expect(report.tokenResult).toBe(tokenResult);
    expect(report.smtpResult).toBeUndefined();
  });

  it("includes smtpResult when provided", () => {
    const findings: Finding[] = [makeFinding("A", Severity.PASS)];
    const smtpResult = {
      connected: true,
      starttls: true,
      authenticated: true,
      emailSent: false,
      transcript: ["S: 220 smtp.office365.com"],
    };

    const report = buildReport(findings, tiers, undefined, smtpResult);
    expect(report.smtpResult).toBe(smtpResult);
    expect(report.tokenResult).toBeUndefined();
  });
});
