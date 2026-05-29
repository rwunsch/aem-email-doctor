import { EmailConfig, Finding, Severity, CheckStep, createFinding } from "./types.js";
import {
  ADOBE_DOCS,
  MICROSOFT_DOCS,
  SEND_AS_KNOWLEDGE,
  RECOMMENDED_SCOPES,
} from "./knowledge-base.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkTenantId(config: EmailConfig): Finding {
  const valid = GUID_RE.test(config.tenantId);
  return createFinding({
    id: "TENANT_ID_FORMAT",
    step: CheckStep.VALIDATE_CONFIG,
    severity: valid ? Severity.PASS : Severity.FAIL,
    title: valid ? "Tenant ID is a valid GUID" : "Tenant ID is not a valid GUID",
    detail: valid
      ? `Tenant ID "${config.tenantId}" matches the expected GUID format.`
      : `Tenant ID "${config.tenantId}" does not match the GUID pattern xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. ` +
        "Copy the Directory (tenant) ID exactly from the Azure portal Overview page.",
    docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    msDocUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
  });
}

function checkClientId(config: EmailConfig): Finding {
  const valid = GUID_RE.test(config.clientId);
  return createFinding({
    id: "CLIENT_ID_FORMAT",
    step: CheckStep.VALIDATE_CONFIG,
    severity: valid ? Severity.PASS : Severity.FAIL,
    title: valid ? "Client ID is a valid GUID" : "Client ID is not a valid GUID",
    detail: valid
      ? `Client ID "${config.clientId}" matches the expected GUID format.`
      : `Client ID "${config.clientId}" does not match the GUID pattern xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. ` +
        "Copy the Application (client) ID exactly from the Azure app registration Overview page.",
    docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    msDocUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
  });
}

function checkScopeOfflineAccess(config: EmailConfig): Finding {
  const hasScope = config.scopes.includes("offline_access");
  return createFinding({
    id: "SCOPE_OFFLINE_ACCESS",
    step: CheckStep.VALIDATE_CONFIG,
    severity: hasScope ? Severity.PASS : Severity.FAIL,
    title: hasScope
      ? "offline_access scope is present"
      : "offline_access scope is missing",
    detail: hasScope
      ? "The offline_access scope enables refresh token issuance, which AEM requires for long-lived mail sessions."
      : "The offline_access scope is required to obtain a refresh token. Without it, AEM can only send mail until the " +
        "access token expires (typically 1 hour) and cannot automatically renew. Add offline_access to the scopes list.",
    fix: hasScope
      ? undefined
      : 'Add "offline_access" to the scopes array in your AEM OAuth2 mail service configuration.',
    fixAction: hasScope
      ? undefined
      : {
          type: "generate-config",
          payload: { addScope: "offline_access" },
        },
    docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    msDocUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
  });
}

function checkScopeSmtpSend(config: EmailConfig): Finding {
  const hasScope = config.scopes.some((s) => s.toLowerCase().includes("smtp.send"));
  return createFinding({
    id: "SCOPE_SMTP_SEND",
    step: CheckStep.VALIDATE_CONFIG,
    severity: hasScope ? Severity.PASS : Severity.FAIL,
    title: hasScope
      ? "SMTP.Send scope is present"
      : "SMTP.Send scope is missing",
    detail: hasScope
      ? "The SMTP.Send scope grants the app permission to submit mail via SMTP AUTH on behalf of the mailbox."
      : "The SMTP.Send scope (https://outlook.office.com/SMTP.Send) is required for authenticated SMTP submission via OAuth2. " +
        "Add it to the scopes list and ensure it has been granted admin consent in the Azure app registration.",
    fix: hasScope
      ? undefined
      : 'Add "https://outlook.office.com/SMTP.Send" to the scopes array.',
    docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    msDocUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
  });
}

function checkScopeCompleteness(config: EmailConfig): Finding {
  const missing = RECOMMENDED_SCOPES.filter((s) => !config.scopes.includes(s));
  const complete = missing.length === 0;
  return createFinding({
    id: "SCOPE_COMPLETENESS",
    step: CheckStep.VALIDATE_CONFIG,
    severity: complete ? Severity.PASS : Severity.WARN,
    title: complete
      ? "All recommended scopes are present"
      : `Recommended scopes missing: ${missing.join(", ")}`,
    detail: complete
      ? "All recommended OIDC scopes (openid, email, profile) are present alongside the required scopes."
      : `The following recommended scopes are absent: ${missing.join(", ")}. ` +
        "While not strictly required for mail delivery, these scopes are recommended by Adobe and may be needed for " +
        "certain AEM features or token introspection. Consider adding them.",
    docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    msDocUrl: MICROSOFT_DOCS.ENTRA_SCOPES_PERMISSIONS,
  });
}

function checkRedirectUri(config: EmailConfig): Finding {
  // Matches http://localhost or http://localhost:<port>
  const localhostRe = /^https?:\/\/localhost(:\d+)?(\/.*)?$/;
  const isLocalhost = localhostRe.test(config.redirectUri);
  return createFinding({
    id: "REDIRECT_URI_FORMAT",
    step: CheckStep.VALIDATE_CONFIG,
    severity: isLocalhost ? Severity.PASS : Severity.WARN,
    title: isLocalhost
      ? "Redirect URI is localhost (expected for AEM OAuth2)"
      : "Redirect URI is not localhost — verify it matches the Azure app registration",
    detail: isLocalhost
      ? `Redirect URI "${config.redirectUri}" points to localhost, which is the standard pattern used when generating ` +
        "the authorization code manually for AEM's offline token setup."
      : `Redirect URI "${config.redirectUri}" does not point to localhost. This is fine if the URI is registered in ` +
        "the Azure app registration and is accessible during the auth code flow. However, localhost is the typical " +
        "value for AEM Cloud Service OAuth2 mail setup, where you capture the auth code from the browser redirect.",
    docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    msDocUrl: MICROSOFT_DOCS.ENTRA_AUTH_CODE_FLOW,
  });
}

function checkFromMatchesUser(config: EmailConfig): Finding {
  const matches = config.fromAddress.toLowerCase() === config.mailbox.toLowerCase();

  if (matches) {
    return createFinding({
      id: "FROM_MATCHES_USER",
      step: CheckStep.VALIDATE_CONFIG,
      severity: Severity.PASS,
      title: "From address matches authenticated mailbox",
      detail: `from.address "${config.fromAddress}" matches smtp.user "${config.mailbox}". No additional Exchange delegation is required.`,
      docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    });
  }

  const optionsSummary = SEND_AS_KNOWLEDGE.options
    .map((o) => `• ${o.name}: ${o.description}`)
    .join("\n");

  const sendAsOption = SEND_AS_KNOWLEDGE.options.find((o) => o.name === "Send As");
  const powershellCmd = sendAsOption?.powershell ?? "";

  return createFinding({
    id: "FROM_MATCHES_USER",
    step: CheckStep.VALIDATE_CONFIG,
    severity: Severity.WARN,
    title: `From address differs from authenticated mailbox — Send As permission required`,
    detail:
      `from.address "${config.fromAddress}" differs from smtp.user "${config.mailbox}". ` +
      `${SEND_AS_KNOWLEDGE.summary}\n\nOptions:\n${optionsSummary}`,
    fix: `Grant the authenticated user "${config.mailbox}" Send As (or Send on Behalf) rights for "${config.fromAddress}" in Exchange Online.`,
    fixAction: {
      type: "copy-command",
      payload: {
        command: powershellCmd
          .replace("noreply@company.com", config.fromAddress)
          .replace("serviceaccount@company.com", config.mailbox),
        language: "powershell",
      },
    },
    docUrl: ADOBE_DOCS.OAUTH2_MAIL_SERVICE,
    msDocUrl: MICROSOFT_DOCS.SEND_AS_PERMISSION,
  });
}

function checkSmtpPortRange(config: EmailConfig): Finding {
  const port = config.smtpPort;
  const inAemRange = port >= 30000 && port <= 30999;

  if (inAemRange) {
    return createFinding({
      id: "SMTP_PORT_RANGE",
      step: CheckStep.VALIDATE_CONFIG,
      severity: Severity.PASS,
      title: `SMTP port ${port} is in the AEM CS advanced networking range (30000–30999)`,
      detail:
        `Port ${port} is within the 30000–30999 range used by AEM Cloud Service advanced networking egress. ` +
        "This port is forwarded to the standard SMTP port by the AEM networking layer.",
      docUrl: ADOBE_DOCS.ADVANCED_NETWORKING,
      msDocUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
    });
  }

  const isRawSmtp = port === 587 || port === 465 || port === 25;
  const rawDetail = isRawSmtp
    ? `Port ${port} is a standard SMTP port that works in many environments, but AEM Cloud Service requires ` +
      "advanced networking egress via ports in the 30000–30999 range (typically 30587 maps to 587 on the exchange server). " +
      `Configure port forwarding in Cloud Manager and update this value to the forwarded port (e.g., ${port === 587 ? "30587" : port === 465 ? "30465" : "30025"}).`
    : `Port ${port} is not in the AEM CS advanced networking range (30000–30999) and is not a recognized standard SMTP port. ` +
      "Verify the port value and ensure it is configured in Cloud Manager advanced networking egress rules.";

  return createFinding({
    id: "SMTP_PORT_RANGE",
    step: CheckStep.VALIDATE_CONFIG,
    severity: Severity.FAIL,
    title: `SMTP port ${port} is outside the AEM CS advanced networking range`,
    detail: rawDetail,
    fix: isRawSmtp
      ? `Change smtpPort to ${port === 587 ? "30587" : port === 465 ? "30465" : "30025"} and configure port forwarding in Cloud Manager.`
      : "Configure an advanced networking egress rule in Cloud Manager and use the corresponding 30000–30999 port.",
    docUrl: ADOBE_DOCS.ADVANCED_NETWORKING,
    msDocUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
  });
}

/**
 * Runs all 8 static configuration checks against the provided EmailConfig.
 * Returns one Finding per check (8 total).
 */
export function validateConfig(config: EmailConfig): Finding[] {
  return [
    checkTenantId(config),
    checkClientId(config),
    checkScopeOfflineAccess(config),
    checkScopeSmtpSend(config),
    checkScopeCompleteness(config),
    checkRedirectUri(config),
    checkFromMatchesUser(config),
    checkSmtpPortRange(config),
  ];
}
