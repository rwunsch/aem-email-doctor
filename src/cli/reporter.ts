import {
  type Finding,
  type ReportSummary,
  type ProviderStatus,
  Severity,
  CheckStep,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const BLUE = "\u001b[34m";
const GRAY = "\u001b[90m";

function color(str: string, ...codes: string[]): string {
  return `${codes.join("")}${str}${RESET}`;
}

/**
 * Removes ANSI escape sequences from a string.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Finding formatter
// ---------------------------------------------------------------------------

const ICONS: Record<Severity, string> = {
  [Severity.PASS]: "✓",
  [Severity.FAIL]: "✗",
  [Severity.WARN]: "⚠",
  [Severity.SKIP]: "○",
};

const SEVERITY_COLORS: Record<Severity, string> = {
  [Severity.PASS]: GREEN,
  [Severity.FAIL]: RED,
  [Severity.WARN]: YELLOW,
  [Severity.SKIP]: GRAY,
};

/**
 * Formats a single finding with icon, severity label, title, and optional fix.
 */
export function formatFinding(finding: Finding): string {
  const icon = ICONS[finding.severity];
  const col = SEVERITY_COLORS[finding.severity];
  const label = finding.severity.toUpperCase();
  const header = color(`${icon} [${label}] ${finding.title}`, col);

  const lines: string[] = [header];

  if (finding.severity === Severity.FAIL || finding.severity === Severity.WARN) {
    lines.push(color(`  ${finding.detail}`, GRAY));
  }

  if (finding.fix) {
    lines.push(color(`  Fix: ${finding.fix}`, YELLOW));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Summary formatter
// ---------------------------------------------------------------------------

/**
 * Formats a summary line: "N passed  N failed  N warnings  N skipped"
 */
export function formatSummary(summary: ReportSummary): string {
  const parts = [
    color(`${summary.pass} passed`, GREEN),
    color(`${summary.fail} failed`, summary.fail > 0 ? RED : GRAY),
    color(`${summary.warn} warnings`, summary.warn > 0 ? YELLOW : GRAY),
    color(`${summary.skip} skipped`, GRAY),
  ];
  return parts.join("  ");
}

// ---------------------------------------------------------------------------
// Step header formatter
// ---------------------------------------------------------------------------

/**
 * Formats a blue bold step header.
 */
export function formatStepHeader(step: string): string {
  return color(`\n── ${step} ──`, BOLD, BLUE);
}

// ---------------------------------------------------------------------------
// Tier status formatter
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<keyof ProviderStatus, string> = {
  core: "Core",
  cloudManager: "Cloud Manager",
  aem: "AEM",
  azure: "Azure / Entra",
};

/**
 * Shows connected/not connected status for each provider tier.
 */
export function formatTierStatus(tiers: ProviderStatus): string {
  const lines: string[] = [color("Provider Tiers:", BOLD)];

  for (const [key, label] of Object.entries(TIER_LABELS)) {
    const connected = tiers[key as keyof ProviderStatus];
    const status = connected
      ? color("connected", GREEN)
      : color("not connected", GRAY);
    lines.push(`  ${label}: ${status}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Step name lookup
// ---------------------------------------------------------------------------

const STEP_NAMES: Record<number, string> = {
  [CheckStep.COLLECT_CONFIG]: "Collect Config",
  [CheckStep.VALIDATE_CONFIG]: "Validate Config",
  [CheckStep.TEST_OAUTH2]: "Test OAuth2",
  [CheckStep.TEST_SMTP]: "Test SMTP",
  [CheckStep.CHECK_AEM_CONFIG]: "Check AEM Config",
  [CheckStep.VERIFY_AEM_RUNTIME]: "Verify AEM Runtime",
  [CheckStep.AZURE_DEEP_DIVE]: "Azure Deep Dive",
  [CheckStep.REPORT]: "Report",
};

// ---------------------------------------------------------------------------
// Full report formatter
// ---------------------------------------------------------------------------

/**
 * Formats a full diagnostic report: header, tiers, findings grouped by step, summary, action items.
 */
export function formatReport(
  findings: Finding[],
  summary: ReportSummary,
  tiers: ProviderStatus
): string {
  const sections: string[] = [];

  // Header
  sections.push(color("\n╔══════════════════════════════════════╗", BOLD, BLUE));
  sections.push(color("  AEM Email Doctor — Diagnostic Report  ", BOLD, BLUE));
  sections.push(color("╚══════════════════════════════════════╝", BOLD, BLUE));

  // Tier status
  sections.push("");
  sections.push(formatTierStatus(tiers));

  // Group findings by step
  const byStep = new Map<number, Finding[]>();
  for (const f of findings) {
    const existing = byStep.get(f.step) ?? [];
    existing.push(f);
    byStep.set(f.step, existing);
  }

  // Sort steps numerically
  const sortedSteps = [...byStep.keys()].sort((a, b) => a - b);

  for (const step of sortedSteps) {
    const stepFindings = byStep.get(step) ?? [];
    const stepName = STEP_NAMES[step] ?? `Step ${step}`;
    sections.push(formatStepHeader(stepName));
    for (const f of stepFindings) {
      sections.push(formatFinding(f));
    }
  }

  // Summary
  sections.push("");
  sections.push(color("Summary:", BOLD));
  sections.push(formatSummary(summary));

  // Action items (failures with fixes)
  const actionItems = findings.filter(
    (f) => f.severity === Severity.FAIL && f.fix
  );
  if (actionItems.length > 0) {
    sections.push("");
    sections.push(color("Action Items:", BOLD, RED));
    for (const f of actionItems) {
      sections.push(color(`  • ${f.title}`, RED));
      sections.push(`    ${f.fix}`);
    }
  }

  sections.push("");

  return sections.join("\n");
}
