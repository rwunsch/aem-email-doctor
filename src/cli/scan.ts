import * as fs from "node:fs";
import * as path from "node:path";
import type { EmailConfig, Finding, ProviderStatus, TokenResult, SmtpTestResult } from "../core/types.js";
import { Severity, CheckStep, createFinding } from "../core/types.js";
import { validateConfig } from "../core/config-validator.js";
import { buildAuthorizeUrl, captureAuthCode, exchangeCodeForTokens, refreshAccessToken } from "../core/oauth.js";
import { testSmtp } from "../core/smtp.js";
import { buildReport } from "../core/checklist.js";
import { formatReport } from "./reporter.js";
import { computeSummary } from "../core/checklist.js";

export interface ScanOptions {
  // Config source
  configFile?: string;

  // Direct config flags
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  mailbox?: string;
  fromAddress?: string;
  smtpPort?: number;
  redirectPort?: number;
  testRecipient?: string;

  // Output options
  outputDir?: string;
  json?: boolean;
  noBrowser?: boolean;
}

/**
 * Loads EmailConfig from flags or a JSON config file.
 * Flags take precedence over file values.
 */
export function loadConfig(options: ScanOptions): EmailConfig {
  let base: Partial<EmailConfig> = {};

  if (options.configFile) {
    const raw = fs.readFileSync(options.configFile, "utf-8");
    base = JSON.parse(raw) as Partial<EmailConfig>;
  }

  const redirectPort = options.redirectPort ?? 8080;
  const redirectUri = `http://localhost:${redirectPort}`;

  const config: EmailConfig = {
    tenantId: options.tenantId ?? base.tenantId ?? "",
    clientId: options.clientId ?? base.clientId ?? "",
    clientSecret: options.clientSecret ?? base.clientSecret ?? "",
    mailbox: options.mailbox ?? base.mailbox ?? "",
    fromAddress: options.fromAddress ?? base.fromAddress ?? "",
    smtpPort: options.smtpPort ?? base.smtpPort ?? 30587,
    redirectUri: base.redirectUri ?? redirectUri,
    scopes: base.scopes ?? [
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "email",
      "profile",
    ],
    testRecipient: options.testRecipient ?? base.testRecipient,
  };

  return config;
}

/**
 * Orchestrates the full diagnostic scan:
 * 1. Load config
 * 2. Validate config
 * 3. OAuth2 flow (auth code → tokens → refresh)
 * 4. SMTP test
 * 5. Build and output report
 * 6. Save report.json and refresh-token.txt
 */
export async function runScan(options: ScanOptions): Promise<void> {
  const findings: Finding[] = [];
  const tiers: ProviderStatus = {
    core: true,
    cloudManager: false,
    aem: false,
    azure: false,
  };

  // Step 1: Load config
  let config: EmailConfig;
  try {
    config = loadConfig(options);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    findings.push(
      createFinding({
        id: "CONFIG_LOAD",
        step: CheckStep.COLLECT_CONFIG,
        severity: Severity.FAIL,
        title: "Failed to load configuration",
        detail: msg,
        fix: "Ensure --config points to a valid JSON file or provide all required flags.",
      })
    );
    outputReport(findings, tiers, options, undefined, undefined);
    return;
  }

  // Step 2: Validate config
  const validationFindings = validateConfig(config);
  findings.push(...validationFindings);

  const hasCriticalFailure = validationFindings.some(
    (f) => f.severity === Severity.FAIL
  );

  if (hasCriticalFailure && !options.tenantId && !options.configFile) {
    outputReport(findings, tiers, options, undefined, undefined);
    return;
  }

  // Step 3: OAuth2 flow
  let tokenResult: TokenResult | undefined;
  try {
    const { url, state } = buildAuthorizeUrl(config);

    if (!options.noBrowser) {
      try {
        const { default: open } = await import("open");
        await open(url);
      } catch {
        // If open fails, just print the URL
      }
    }

    console.error(`\nOpen this URL in your browser to authorize:\n${url}\n`);

    let authCode: string;
    try {
      authCode = await captureAuthCode(config.redirectUri, state, { timeoutMs: 5 * 60 * 1000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      findings.push(
        createFinding({
          id: "OAUTH2_AUTH_CODE",
          step: CheckStep.TEST_OAUTH2,
          severity: Severity.FAIL,
          title: "Failed to capture authorization code",
          detail: msg,
          fix: "Complete the browser authorization flow within 5 minutes.",
        })
      );
      outputReport(findings, tiers, options, undefined, undefined);
      return;
    }

    const { tokens: exchangeTokens, finding: exchangeFinding } =
      await exchangeCodeForTokens(config, authCode);
    findings.push(exchangeFinding);
    tiers.azure = true;

    // Refresh token test
    const { tokens: refreshedTokens, finding: refreshFinding } =
      await refreshAccessToken(config, exchangeTokens.refreshToken);
    findings.push(refreshFinding);
    tokenResult = refreshedTokens;

    // Save refresh token
    if (options.outputDir) {
      fs.mkdirSync(options.outputDir, { recursive: true });
      fs.writeFileSync(
        path.join(options.outputDir, "refresh-token.txt"),
        exchangeTokens.refreshToken,
        "utf-8"
      );
    }

    // Step 4: SMTP test
    let smtpResult: SmtpTestResult | undefined;
    try {
      const { result, findings: smtpFindings } = await testSmtp(
        config,
        tokenResult.accessToken,
        {
          sendTestEmail: !!config.testRecipient,
        }
      );
      findings.push(...smtpFindings);
      smtpResult = result;
      if (result.connected) tiers.core = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      findings.push(
        createFinding({
          id: "SMTP_TEST",
          step: CheckStep.TEST_SMTP,
          severity: Severity.FAIL,
          title: "SMTP test failed unexpectedly",
          detail: msg,
        })
      );
    }

    outputReport(findings, tiers, options, tokenResult, smtpResult);
  } catch (err: unknown) {
    const e = err as Error & { finding?: Finding };
    if (e.finding) {
      findings.push(e.finding);
    } else {
      findings.push(
        createFinding({
          id: "OAUTH2_UNEXPECTED",
          step: CheckStep.TEST_OAUTH2,
          severity: Severity.FAIL,
          title: "Unexpected OAuth2 error",
          detail: e.message,
        })
      );
    }
    outputReport(findings, tiers, options, undefined, undefined);
  }
}

function outputReport(
  findings: Finding[],
  tiers: ProviderStatus,
  options: ScanOptions,
  tokenResult: TokenResult | undefined,
  smtpResult: SmtpTestResult | undefined
): void {
  const report = buildReport(findings, tiers, tokenResult, smtpResult);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const summary = computeSummary(findings);
    console.log(formatReport(findings, summary, tiers));
  }

  if (options.outputDir) {
    fs.mkdirSync(options.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.outputDir, "report.json"),
      JSON.stringify(report, null, 2),
      "utf-8"
    );
  }
}
