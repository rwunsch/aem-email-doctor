import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Finding, Severity, CheckStep, createFinding } from "../core/types.js";
import { ADOBE_DOCS } from "../core/knowledge-base.js";

const execFileAsync = promisify(execFile);

async function aio(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("aio", ["cloudmanager", ...args, "--json"], {
    timeout: 30_000,
  });
  return stdout;
}

export async function listEnvironmentVariables(
  programId: string,
  envId: string
): Promise<{ variables: Array<{ name: string; type: string; value?: string }>; findings: Finding[] }> {
  const findings: Finding[] = [];

  try {
    const raw = await aio([
      "environment:list-variables",
      envId,
      "-p",
      programId,
    ]);
    const variables = JSON.parse(raw) as Array<{ name: string; type: string; value?: string }>;

    // Check for required secrets
    const secretNames = variables.filter((v) => v.type === "secretString").map((v) => v.name);
    const hasClientSecret = secretNames.some((n) =>
      n.toLowerCase().includes("oauth") && n.toLowerCase().includes("client") && n.toLowerCase().includes("secret")
    );
    const hasRefreshToken = secretNames.some((n) =>
      n.toLowerCase().includes("oauth") && n.toLowerCase().includes("refresh")
    );

    findings.push(createFinding({
      id: "CM_SECRETS_SET",
      step: CheckStep.CHECK_AEM_CONFIG,
      severity: hasClientSecret && hasRefreshToken ? Severity.PASS : Severity.FAIL,
      title: hasClientSecret && hasRefreshToken
        ? "Cloud Manager OAuth secrets are set"
        : "Cloud Manager OAuth secrets missing",
      detail: `Found secrets: ${secretNames.join(", ") || "none"}. ` +
        `Client secret: ${hasClientSecret ? "found" : "MISSING"}. ` +
        `Refresh token: ${hasRefreshToken ? "found" : "MISSING"}.`,
      fix: !hasClientSecret || !hasRefreshToken
        ? "Set SECRET_SMTP_OAUTH_CLIENT_SECRET and SECRET_SMTP_OAUTH_REFRESH_TOKEN as secret environment variables in Cloud Manager."
        : undefined,
      evidence: `Variables: ${variables.map((v) => `${v.name} (${v.type})`).join(", ")}`,
      docUrl: ADOBE_DOCS.CLOUD_MANAGER_ENV_VARS,
    }));

    // Check for EMAIL_USERNAME
    const hasEmailUsername = variables.some((v) => v.name === "EMAIL_USERNAME");
    findings.push(createFinding({
      id: "CM_ENV_VARS_SET",
      step: CheckStep.CHECK_AEM_CONFIG,
      severity: hasEmailUsername ? Severity.PASS : Severity.WARN,
      title: hasEmailUsername
        ? "EMAIL_USERNAME environment variable is set"
        : "EMAIL_USERNAME environment variable not found",
      detail: hasEmailUsername
        ? `EMAIL_USERNAME is set in Cloud Manager.`
        : "EMAIL_USERNAME is commonly used to store the SMTP user email. It may be hardcoded in OSGi config instead.",
      docUrl: ADOBE_DOCS.CLOUD_MANAGER_ENV_VARS,
    }));

    return { variables, findings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    findings.push(createFinding({
      id: "CM_SECRETS_SET",
      step: CheckStep.CHECK_AEM_CONFIG,
      severity: Severity.FAIL,
      title: "Could not read Cloud Manager variables",
      detail: `aio cloudmanager error: ${message}`,
      fix: "Ensure aio CLI is authenticated: run 'aio login' and 'aio cloudmanager:org:select'.",
    }));
    return { variables: [], findings };
  }
}
