import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EmailConfig, Finding, ProviderStatus, TokenResult } from "../core/types.js";
import { Severity, CheckStep, createFinding } from "../core/types.js";
import { validateConfig } from "../core/config-validator.js";
import { buildAuthorizeUrl, captureAuthCode, exchangeCodeForTokens, refreshAccessToken } from "../core/oauth.js";
import { testSmtp } from "../core/smtp.js";
import { generateOAuthConfig, generateMailServiceConfig, generateCloudManagerVariables } from "../core/config-generator.js";
import { buildReport } from "../core/checklist.js";
import { formatFinding, formatSummary, formatTierStatus, stripAnsi } from "./reporter.js";
import { computeSummary } from "../core/checklist.js";

export interface WizardOptions {
  configFile?: string;
  outputDir?: string;
}

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function askSecret(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`${question}: `);
    // For non-TTY environments, fall back to regular input
    rl.question("", (answer) => {
      resolve(answer.trim());
    });
  });
}

function print(msg: string): void {
  console.log(msg);
}

function printStep(n: number, total: number, title: string): void {
  print(`\n\u001b[1m\u001b[34m[${ n}/${total}] ${title}\u001b[0m`);
  print("─".repeat(50));
}

// ---------------------------------------------------------------------------
// Wizard entry point
// ---------------------------------------------------------------------------

/**
 * Interactive 6-step wizard for AEM email OAuth2 setup.
 */
export async function runWizard(options: WizardOptions): Promise<void> {
  const rl = createInterface();

  try {
    await runWizardWithInterface(rl, options);
  } finally {
    rl.close();
  }
}

async function runWizardWithInterface(rl: readline.Interface, options: WizardOptions): Promise<void> {
  print("\u001b[1m\u001b[32m");
  print("╔════════════════════════════════════════╗");
  print("  AEM Email Doctor — Setup Wizard");
  print("╚════════════════════════════════════════╝");
  print("\u001b[0m");
  print("This wizard will guide you through configuring Microsoft 365 OAuth2 for AEM CS.\n");

  // Load base config if provided
  let base: Partial<EmailConfig> = {};
  if (options.configFile && fs.existsSync(options.configFile)) {
    try {
      base = JSON.parse(fs.readFileSync(options.configFile, "utf-8")) as Partial<EmailConfig>;
      print(`Loaded existing config from ${options.configFile}\n`);
    } catch {
      print(`Warning: Could not parse ${options.configFile}, starting fresh.\n`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: Collect config
  // -------------------------------------------------------------------------
  printStep(1, 6, "Collect Configuration");
  print("Enter your Azure AD / Microsoft Entra configuration details.\n");

  const tenantId = await ask(rl, "Tenant ID (Azure AD Directory ID)", base.tenantId);
  const clientId = await ask(rl, "Client ID (Application ID)", base.clientId);
  const clientSecret = await askSecret(rl, "Client Secret (hidden)");
  const mailbox = await ask(rl, "SMTP Mailbox (smtp.user email)", base.mailbox);
  const fromAddress = await ask(rl, "From Address", base.fromAddress ?? mailbox);
  const smtpPortStr = await ask(rl, "SMTP Port (AEM CS advanced networking)", String(base.smtpPort ?? 30587));
  const smtpPort = parseInt(smtpPortStr, 10) || 30587;

  const redirectPortStr = await ask(rl, "Local redirect port for OAuth2 callback", "8080");
  const redirectPort = parseInt(redirectPortStr, 10) || 8080;
  const redirectUri = `http://localhost:${redirectPort}`;

  const testRecipientInput = await ask(rl, "Test email recipient (optional, press Enter to skip)");

  const config: EmailConfig = {
    tenantId,
    clientId,
    clientSecret,
    mailbox,
    fromAddress,
    smtpPort,
    redirectUri,
    scopes: base.scopes ?? [
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "email",
      "profile",
    ],
    testRecipient: testRecipientInput || undefined,
  };

  // -------------------------------------------------------------------------
  // Step 2: Validate config
  // -------------------------------------------------------------------------
  printStep(2, 6, "Validate Configuration");

  const findings: Finding[] = [];
  const validationFindings = validateConfig(config);
  findings.push(...validationFindings);

  for (const f of validationFindings) {
    print(formatFinding(f));
  }

  const validSummary = computeSummary(validationFindings);
  print(`\n${formatSummary(validSummary)}`);

  const hasCriticalFail = validationFindings.some((f) => f.severity === Severity.FAIL);
  if (hasCriticalFail) {
    print("\n\u001b[31mConfiguration has critical errors. Please fix them before continuing.\u001b[0m");
    const cont = await ask(rl, "Continue anyway? (y/N)", "n");
    if (cont.toLowerCase() !== "y") {
      print("Exiting. Fix the configuration issues and re-run setup.");
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: OAuth2 authorization
  // -------------------------------------------------------------------------
  printStep(3, 6, "OAuth2 Authorization");
  print("We'll now open the Microsoft authorization URL in your browser.\n");

  const { url, state } = buildAuthorizeUrl(config);

  try {
    const { default: open } = await import("open");
    await open(url);
    print("Browser opened. If it didn't open automatically, visit this URL:");
  } catch {
    print("Could not open browser automatically. Visit this URL:");
  }
  print(`\n  ${url}\n`);

  print(`Waiting for authorization callback on ${config.redirectUri} ...`);

  let tokenResult: TokenResult | undefined;
  try {
    const authCode = await captureAuthCode(config.redirectUri, state, { timeoutMs: 5 * 60 * 1000 });
    print("\u001b[32mAuthorization code received.\u001b[0m");

    const { tokens: exchangeTokens, finding: exchangeFinding } =
      await exchangeCodeForTokens(config, authCode);
    findings.push(exchangeFinding);
    print(formatFinding(exchangeFinding));

    print("\nTesting refresh token...");
    const { tokens: refreshedTokens, finding: refreshFinding } =
      await refreshAccessToken(config, exchangeTokens.refreshToken);
    findings.push(refreshFinding);
    print(formatFinding(refreshFinding));

    tokenResult = refreshedTokens;

    // Save refresh token
    const outputDir = options.outputDir ?? ".";
    fs.mkdirSync(outputDir, { recursive: true });
    const tokenPath = path.join(outputDir, "refresh-token.txt");
    fs.writeFileSync(tokenPath, exchangeTokens.refreshToken, "utf-8");
    print(`\n\u001b[32mRefresh token saved to: ${tokenPath}\u001b[0m`);
  } catch (err: unknown) {
    const e = err as Error & { finding?: Finding };
    const f = e.finding ?? createFinding({
      id: "OAUTH2_WIZARD",
      step: CheckStep.TEST_OAUTH2,
      severity: Severity.FAIL,
      title: "OAuth2 authorization failed",
      detail: e.message,
    });
    findings.push(f);
    print(formatFinding(f));
    print("\n\u001b[31mOAuth2 step failed. Skipping SMTP test.\u001b[0m");
  }

  // -------------------------------------------------------------------------
  // Step 4: SMTP test
  // -------------------------------------------------------------------------
  printStep(4, 6, "SMTP Test");

  const tiers: ProviderStatus = {
    core: true,
    cloudManager: false,
    aem: false,
    azure: tokenResult !== undefined,
  };

  if (tokenResult) {
    print("Testing SMTP connectivity with OAuth2 access token...\n");
    try {
      const sendTest = !!config.testRecipient;
      const { result, findings: smtpFindings } = await testSmtp(
        config,
        tokenResult.accessToken,
        { sendTestEmail: sendTest }
      );

      findings.push(...smtpFindings);
      for (const f of smtpFindings) {
        print(formatFinding(f));
      }

      if (result.connected) tiers.core = true;
      if (result.emailSent) {
        print(`\n\u001b[32mTest email sent to ${config.testRecipient}.\u001b[0m`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? (err as Error).message : String(err);
      const f = createFinding({
        id: "SMTP_WIZARD",
        step: CheckStep.TEST_SMTP,
        severity: Severity.FAIL,
        title: "SMTP test error",
        detail: msg,
      });
      findings.push(f);
      print(formatFinding(f));
    }
  } else {
    print("Skipping SMTP test (no access token available).");
    findings.push(
      createFinding({
        id: "SMTP_WIZARD",
        step: CheckStep.TEST_SMTP,
        severity: Severity.SKIP,
        title: "SMTP test skipped — OAuth2 step did not complete",
        detail: "Complete the OAuth2 step to enable SMTP testing.",
      })
    );
  }

  // -------------------------------------------------------------------------
  // Step 5: Generate configs
  // -------------------------------------------------------------------------
  printStep(5, 6, "Generate Configuration Files");

  const outputDir = options.outputDir ?? ".";
  fs.mkdirSync(outputDir, { recursive: true });

  // OAuthConfigurationProviderImpl.cfg.json
  const oauthCfg = generateOAuthConfig(config);
  const oauthPath = path.join(outputDir, "OAuthConfigurationProviderImpl.cfg.json");
  fs.writeFileSync(oauthPath, oauthCfg, "utf-8");
  print(`  Generated: ${oauthPath}`);

  // DefaultMailService.cfg.json
  const mailCfg = generateMailServiceConfig(config);
  const mailPath = path.join(outputDir, "DefaultMailService.cfg.json");
  fs.writeFileSync(mailPath, mailCfg, "utf-8");
  print(`  Generated: ${mailPath}`);

  // Cloud Manager variables script
  const refreshToken = tokenResult?.refreshToken;
  const cmVars = generateCloudManagerVariables(config, refreshToken);
  const cmPath = path.join(outputDir, "cloud-manager-variables.txt");
  fs.writeFileSync(cmPath, cmVars, "utf-8");
  print(`  Generated: ${cmPath}`);

  // Report JSON
  const report = buildReport(findings, tiers, tokenResult, undefined);
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  print(`  Generated: ${reportPath}`);

  // -------------------------------------------------------------------------
  // Step 6: Summary and next steps
  // -------------------------------------------------------------------------
  printStep(6, 6, "Summary & Next Steps");

  print(formatTierStatus(tiers));
  print("");

  const finalSummary = computeSummary(findings);
  print(formatSummary(finalSummary));
  print("");

  print("\u001b[1mNext Steps:\u001b[0m");
  print("1. Deploy the generated OSGi config files to your AEM Cloud Service repository:");
  print(`   - ${stripAnsi(oauthPath)}`);
  print(`   - ${stripAnsi(mailPath)}`);
  print("2. Set Cloud Manager secret variables (see cloud-manager-variables.txt):");
  print("   - SECRET_SMTP_OAUTH_CLIENT_SECRET");
  print("   - SECRET_SMTP_OAUTH_REFRESH_TOKEN");
  print("3. Trigger a Cloud Manager pipeline deployment to apply the configuration.");
  print("4. Verify mail delivery in AEM with the Workflow Email process step.");
  print("");
  print("\u001b[32mSetup complete! Review the files in: " + outputDir + "\u001b[0m");
}
