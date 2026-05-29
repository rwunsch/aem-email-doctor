import type { EmailConfig } from "./types.js";

const AUTHORIZE_BASE = "https://login.microsoftonline.com";

/**
 * Generates an OAuthConfigurationProviderImpl.cfg.json OSGi configuration.
 * Secrets are referenced via AEM secret placeholders.
 */
export function generateOAuthConfig(config: EmailConfig): string {
  const tenantId = config.tenantId;
  const authUrl = `${AUTHORIZE_BASE}/${tenantId}/oauth2/v2.0/authorize`;
  const tokenUrl = `${AUTHORIZE_BASE}/${tenantId}/oauth2/v2.0/token`;
  const refreshUrl = `${AUTHORIZE_BASE}/${tenantId}/oauth2/v2.0/token`;

  const cfg = {
    authUrl,
    tokenUrl,
    refreshUrl,
    clientId: config.clientId,
    clientSecret: "$[secret:SECRET_SMTP_OAUTH_CLIENT_SECRET]",
    refreshToken: "$[secret:SECRET_SMTP_OAUTH_REFRESH_TOKEN]",
    scopes: config.scopes.join(" "),
    authCodeRedirectUrl: config.redirectUri,
  };

  return JSON.stringify(cfg, null, 2);
}

/**
 * Generates a DefaultMailService.cfg.json OSGi configuration.
 * Uses AEM proxy host env placeholder for smtp.host.
 */
export function generateMailServiceConfig(config: EmailConfig): string {
  const cfg: Record<string, unknown> = {
    "smtp.host": "$[env:AEM_PROXY_HOST;default=proxy.tunnel]",
    "smtp.user": config.mailbox,
    "smtp.port": config.smtpPort,
    "from.address": config.fromAddress,
    "smtp.ssl": false,
    "smtp.starttls": true,
    "oauth.flow": true,
  };

  return JSON.stringify(cfg, null, 2);
}

/**
 * Generates Cloud Manager variable list and aio CLI commands for setting secrets.
 */
export function generateCloudManagerVariables(
  config: EmailConfig,
  refreshToken?: string
): string {
  const lines: string[] = [
    "# Cloud Manager Environment Variables",
    "# Set these as SECRET type variables in your AEM CS environment",
    "#",
    "# Variable names:",
    "#   SECRET_SMTP_OAUTH_CLIENT_SECRET  - Your Azure app client secret",
    "#   SECRET_SMTP_OAUTH_REFRESH_TOKEN  - The OAuth2 refresh token obtained via auth code flow",
    "",
    "# Using the Adobe I/O CLI (aio):",
    "# Install: npm install -g @adobe/aio-cli",
    "# Login:   aio auth login",
    "",
    "# Set client secret:",
    `aio cloudmanager:set-environment-variables <programId> <environmentId> \\`,
    `  --secret SECRET_SMTP_OAUTH_CLIENT_SECRET="${config.clientSecret}"`,
    "",
    "# Set refresh token:",
    `aio cloudmanager:set-environment-variables <programId> <environmentId> \\`,
    `  --secret SECRET_SMTP_OAUTH_REFRESH_TOKEN="${refreshToken ?? "<paste-refresh-token-here>"}"`,
    "",
    "# Note: Replace <programId> and <environmentId> with your Cloud Manager values.",
    "# The client secret should NOT be committed to source control.",
  ];

  return lines.join("\n");
}
