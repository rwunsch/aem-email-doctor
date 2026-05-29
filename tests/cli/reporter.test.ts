import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  formatFinding,
  formatSummary,
  formatStepHeader,
  formatTierStatus,
  formatReport,
} from "../../src/cli/reporter.js";
import { Severity, CheckStep, createFinding, type Finding, type ReportSummary, type ProviderStatus } from "../../src/core/types.js";

function makeFinding(id: string, severity: Severity, fix?: string): Finding {
  return createFinding({
    id,
    step: CheckStep.VALIDATE_CONFIG,
    severity,
    title: `Finding ${id}`,
    detail: `Detail for ${id}`,
    fix,
  });
}

describe("stripAnsi", () => {
  it("removes ANSI escape sequences", () => {
    const colored = "\u001b[32m✓ PASS\u001b[0m";
    expect(stripAnsi(colored)).toBe("✓ PASS");
  });

  it("leaves plain strings unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("removes bold and color codes", () => {
    const bold = "\u001b[1m\u001b[34mBlue Bold\u001b[0m";
    expect(stripAnsi(bold)).toBe("Blue Bold");
  });
});

describe("formatFinding", () => {
  it("uses ✓ icon for PASS", () => {
    const finding = makeFinding("A", Severity.PASS);
    const output = stripAnsi(formatFinding(finding));
    expect(output).toContain("✓");
    expect(output).toContain("Finding A");
  });

  it("uses ✗ icon for FAIL", () => {
    const finding = makeFinding("B", Severity.FAIL, "Fix this issue");
    const output = stripAnsi(formatFinding(finding));
    expect(output).toContain("✗");
    expect(output).toContain("Finding B");
  });

  it("uses ⚠ icon for WARN", () => {
    const finding = makeFinding("C", Severity.WARN);
    const output = stripAnsi(formatFinding(finding));
    expect(output).toContain("⚠");
  });

  it("uses ○ icon for SKIP", () => {
    const finding = makeFinding("D", Severity.SKIP);
    const output = stripAnsi(formatFinding(finding));
    expect(output).toContain("○");
  });

  it("shows fix for FAIL findings", () => {
    const finding = makeFinding("E", Severity.FAIL, "Run this command to fix");
    const output = stripAnsi(formatFinding(finding));
    expect(output).toContain("Run this command to fix");
  });

  it("shows severity label", () => {
    const finding = makeFinding("F", Severity.FAIL);
    const output = stripAnsi(formatFinding(finding));
    // Should show FAIL or fail label
    expect(output.toLowerCase()).toContain("fail");
  });
});

describe("formatSummary", () => {
  it("shows passed/failed/warnings/skipped counts", () => {
    const summary: ReportSummary = { pass: 5, fail: 2, warn: 1, skip: 3, total: 11 };
    const output = stripAnsi(formatSummary(summary));
    expect(output).toContain("5");
    expect(output).toContain("2");
    expect(output).toContain("1");
    expect(output).toContain("3");
  });

  it("uses descriptive labels", () => {
    const summary: ReportSummary = { pass: 5, fail: 2, warn: 1, skip: 3, total: 11 };
    const output = stripAnsi(formatSummary(summary)).toLowerCase();
    // Should have some kind of pass/fail labels
    expect(output).toMatch(/pass|passed/);
    expect(output).toMatch(/fail|failed/);
  });
});

describe("formatStepHeader", () => {
  it("includes the step name in output", () => {
    const output = stripAnsi(formatStepHeader("VALIDATE CONFIG"));
    expect(output).toContain("VALIDATE CONFIG");
  });
});

describe("formatTierStatus", () => {
  it("shows connected status per tier", () => {
    const tiers: ProviderStatus = {
      core: true,
      cloudManager: false,
      aem: false,
      azure: false,
    };
    const output = stripAnsi(formatTierStatus(tiers));
    expect(output.toLowerCase()).toMatch(/core/);
    expect(output.toLowerCase()).toMatch(/connected|not connected/);
  });
});

describe("formatReport", () => {
  it("produces a multi-line report string", () => {
    const findings: Finding[] = [
      makeFinding("A", Severity.PASS),
      makeFinding("B", Severity.FAIL, "Fix B"),
    ];
    const summary: ReportSummary = { pass: 1, fail: 1, warn: 0, skip: 0, total: 2 };
    const tiers: ProviderStatus = { core: true, cloudManager: false, aem: false, azure: false };

    const output = stripAnsi(formatReport(findings, summary, tiers));
    expect(output.split("\n").length).toBeGreaterThan(5);
    expect(output).toContain("Finding A");
    expect(output).toContain("Finding B");
  });

  it("includes action items section when there are failures", () => {
    const findings: Finding[] = [
      makeFinding("A", Severity.FAIL, "Fix this now"),
    ];
    const summary: ReportSummary = { pass: 0, fail: 1, warn: 0, skip: 0, total: 1 };
    const tiers: ProviderStatus = { core: true, cloudManager: false, aem: false, azure: false };

    const output = stripAnsi(formatReport(findings, summary, tiers));
    expect(output.toLowerCase()).toMatch(/action|fix/);
  });
});
