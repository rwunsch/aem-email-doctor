#!/usr/bin/env node
import { Command } from "commander";
import { runScan } from "./scan.js";

const program = new Command();

program
  .name("aem-email-doctor")
  .description("Diagnostic tool for AEM as a Cloud Service email configuration with Microsoft 365 OAuth2")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// scan command
// ---------------------------------------------------------------------------
program
  .command("scan")
  .description("Run a full diagnostic scan: validate config, OAuth2 flow, SMTP test, and report")
  .option("--config <file>", "Path to JSON config file")
  .option("--tenant-id <id>", "Azure AD tenant ID (GUID)")
  .option("--client-id <id>", "Azure AD application (client) ID (GUID)")
  .option("--client-secret <secret>", "Azure AD client secret")
  .option("--mailbox <email>", "SMTP authenticated mailbox (smtp.user)")
  .option("--from <email>", "From address for outgoing mail")
  .option("--smtp-port <port>", "SMTP port (AEM CS: 30587)", parseInt)
  .option("--redirect-port <port>", "Local redirect server port for OAuth2 (default: 8080)", parseInt)
  .option("--test-recipient <email>", "Send a test email to this address")
  .option("--output-dir <dir>", "Directory to save report.json and refresh-token.txt")
  .option("--json", "Output report as JSON instead of formatted text")
  .option("--no-browser", "Skip automatic browser launch (print URL instead)")
  .action(async (opts: {
    config?: string;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    mailbox?: string;
    from?: string;
    smtpPort?: number;
    redirectPort?: number;
    testRecipient?: string;
    outputDir?: string;
    json?: boolean;
    browser?: boolean;
  }) => {
    await runScan({
      configFile: opts.config,
      tenantId: opts.tenantId,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      mailbox: opts.mailbox,
      fromAddress: opts.from,
      smtpPort: opts.smtpPort,
      redirectPort: opts.redirectPort,
      testRecipient: opts.testRecipient,
      outputDir: opts.outputDir,
      json: opts.json,
      noBrowser: opts.browser === false,
    });
  });

// ---------------------------------------------------------------------------
// setup command (wizard)
// ---------------------------------------------------------------------------
program
  .command("setup")
  .description("Interactive wizard to configure AEM email with Microsoft 365 OAuth2")
  .option("--config <file>", "Path to existing JSON config file to load")
  .option("--output-dir <dir>", "Directory to save generated config files")
  .action(async (opts: { config?: string; outputDir?: string }) => {
    const { runWizard } = await import("./wizard.js");
    await runWizard({ configFile: opts.config, outputDir: opts.outputDir });
  });

// ---------------------------------------------------------------------------
// serve command (web UI)
// ---------------------------------------------------------------------------
program
  .command("serve")
  .description("Start web UI dashboard")
  .option("--port <port>", "Web UI port", (v: string) => parseInt(v, 10), 5000)
  .action(async (opts: { port: number }) => {
    const { startServer } = await import("../web/server.js");
    startServer(opts.port);
  });

program.parse(process.argv);
