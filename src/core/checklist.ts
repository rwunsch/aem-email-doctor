import {
  type Finding,
  type DiagnosticReport,
  type ReportSummary,
  type ProviderStatus,
  type TokenResult,
  type SmtpTestResult,
  Severity,
} from "./types.js";

/**
 * Counts pass/fail/warn/skip findings and returns a ReportSummary.
 */
export function computeSummary(findings: Finding[]): ReportSummary {
  let pass = 0;
  let fail = 0;
  let warn = 0;
  let skip = 0;

  for (const f of findings) {
    switch (f.severity) {
      case Severity.PASS:
        pass++;
        break;
      case Severity.FAIL:
        fail++;
        break;
      case Severity.WARN:
        warn++;
        break;
      case Severity.SKIP:
        skip++;
        break;
    }
  }

  return { pass, fail, warn, skip, total: findings.length };
}

/**
 * Builds a DiagnosticReport wrapping findings with timestamp, summary, and tier status.
 */
export function buildReport(
  findings: Finding[],
  tiers: ProviderStatus,
  tokenResult?: TokenResult,
  smtpResult?: SmtpTestResult
): DiagnosticReport {
  const summary = computeSummary(findings);

  return {
    timestamp: new Date().toISOString(),
    findings,
    summary,
    tiers,
    tokenResult,
    smtpResult,
  };
}
