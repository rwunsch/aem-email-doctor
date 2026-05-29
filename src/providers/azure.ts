import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Finding, Severity, CheckStep, createFinding } from "../core/types.js";
import { MICROSOFT_DOCS } from "../core/knowledge-base.js";

const execFileAsync = promisify(execFile);

async function az(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("az", args, { timeout: 30_000 });
  return stdout;
}

export async function checkAppRegistration(
  clientId: string
): Promise<Finding[]> {
  const findings: Finding[] = [];

  try {
    const raw = await az([
      "ad", "app", "show", "--id", clientId, "--output", "json",
    ]);
    const app = JSON.parse(raw) as Record<string, unknown>;

    findings.push(createFinding({
      id: "AZURE_APP_EXISTS",
      step: CheckStep.AZURE_DEEP_DIVE,
      severity: Severity.PASS,
      title: `Azure app registration found: ${clientId}`,
      detail: `App name: ${app.displayName ?? "unknown"}`,
      msDocUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
    }));

    // Check redirect URIs
    const web = app.web as { redirectUris?: string[] } | undefined;
    const uris = web?.redirectUris ?? [];
    const hasLocalhost = uris.some((u: string) => u.startsWith("http://localhost"));
    findings.push(createFinding({
      id: "AZURE_REDIRECT_URIS",
      step: CheckStep.AZURE_DEEP_DIVE,
      severity: hasLocalhost ? Severity.PASS : Severity.WARN,
      title: hasLocalhost
        ? "Redirect URI includes localhost"
        : "No localhost redirect URI found in app registration",
      detail: `Registered URIs: ${uris.join(", ") || "none"}`,
      fix: hasLocalhost ? undefined : "Add http://localhost and http://localhost/ as redirect URIs in the app registration.",
      evidence: JSON.stringify(uris),
      msDocUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    findings.push(createFinding({
      id: "AZURE_APP_EXISTS",
      step: CheckStep.AZURE_DEEP_DIVE,
      severity: Severity.FAIL,
      title: "Could not check Azure app registration",
      detail: `az ad app show failed: ${message}`,
      fix: "Ensure Azure CLI is authenticated to the correct tenant: run 'az login --tenant <tenantId>'.",
    }));
  }

  return findings;
}
