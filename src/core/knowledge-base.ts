/** Adobe Experience League documentation references */
export const ADOBE_DOCS = {
  OAUTH2_MAIL_SERVICE:
    "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/oauth2-support-for-mail-service",
  ADVANCED_NETWORKING:
    "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/configuring-advanced-networking",
  CLOUD_MANAGER_ENV_VARS:
    "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/environment-variables",
} as const;

/** Microsoft Learn / Entra documentation references */
export const MICROSOFT_DOCS = {
  SMTP_AUTH_OAUTH2:
    "https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth",
  ENTRA_AUTH_CODE_FLOW:
    "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow",
  ENTRA_SCOPES_PERMISSIONS:
    "https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc",
  SMTP_AUTH_ENABLE:
    "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission",
  SEND_AS_PERMISSION:
    "https://learn.microsoft.com/en-us/exchange/recipients-in-exchange-online/manage-permissions-for-recipients",
  SEND_ON_BEHALF:
    "https://learn.microsoft.com/en-us/microsoft-365/admin/add-users/give-mailbox-permissions-to-another-user",
  SHARED_MAILBOXES:
    "https://learn.microsoft.com/en-us/microsoft-365/admin/email/about-shared-mailboxes",
  REFRESH_TOKEN_LIFETIME:
    "https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens",
  AADSTS_ERROR_CODES:
    "https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes",
  EXCHANGE_RECIPIENT_PERMISSIONS:
    "https://learn.microsoft.com/en-us/powershell/module/exchange/add-recipientpermission",
} as const;

/** Explanations for common Microsoft Entra error codes */
export const ENTRA_ERRORS: Record<string, { summary: string; likely_cause: string; fix: string }> = {
  AADSTS70008: {
    summary: "Authorization code or refresh token expired due to inactivity.",
    likely_cause:
      "The authorization code was reused, exchanged too late (>10 min), or the redirect_uri in the token request does not match the authorize request.",
    fix: "Generate a fresh authorization code and exchange it immediately (within seconds). Ensure redirect_uri matches exactly between authorize URL, token request, and Azure app registration.",
  },
  AADSTS700082: {
    summary: "Refresh token expired due to inactivity (90-day default).",
    likely_cause:
      "The refresh token was not used for 90+ days. Microsoft invalidates inactive refresh tokens.",
    fix: "Generate a new refresh token via the full authorization code flow. Ensure AEM sends mail regularly to keep the token active, or rotate before the 90-day window.",
  },
  AADSTS700016: {
    summary: "Application not found in the specified tenant directory.",
    likely_cause:
      "The client_id or tenant_id in the token request is wrong, or the app registration was deleted.",
    fix: "Verify tenant_id and client_id match the Azure app registration exactly.",
  },
  AADSTS7000215: {
    summary: "Invalid client secret provided.",
    likely_cause:
      "The client_secret value is wrong, expired, or was copied incorrectly (common with special characters).",
    fix: "Generate a new client secret in Azure portal and update the configuration.",
  },
  AADSTS65001: {
    summary: "User or admin has not consented to use the application.",
    likely_cause:
      "Admin consent was not granted for the required permissions (SMTP.Send, offline_access).",
    fix: "Have an Azure AD admin grant consent for all requested permissions in the app registration.",
  },
  "535 5.7.3": {
    summary: "SMTP authentication unsuccessful.",
    likely_cause:
      "The OAuth2 access token is invalid, expired, or the mailbox does not have SMTP AUTH enabled.",
    fix: "Verify SMTP AUTH is enabled for the mailbox in Microsoft 365 admin center. Check that the access token was obtained with the correct scopes.",
  },
  "535 5.7.139": {
    summary: "SMTP client authentication is disabled for the tenant.",
    likely_cause:
      "SMTP AUTH is disabled at the Exchange Online organization level, or Security Defaults are blocking it.",
    fix: "Enable SMTP AUTH at tenant level in Exchange admin center, or create a Conditional Access exception. See Microsoft docs on authenticated SMTP submission.",
  },
};

/**
 * Knowledge base for the FROM_MATCHES_USER check.
 */
export const SEND_AS_KNOWLEDGE = {
  summary:
    "When smtp.user and from.address differ, Microsoft 365 requires explicit permission. " +
    "The authenticated user must have 'Send As' or 'Send on Behalf' rights for the From address.",

  options: [
    {
      name: "Send As",
      description:
        "The recipient sees mail as coming directly from the From address (e.g., noreply@company.com). " +
        "No 'on behalf of' notation is shown.",
      how: "Exchange Online Admin Center → Recipients → Mailboxes → select the From mailbox → Delegation → Send As → add the service account. " +
        "Or via PowerShell: Add-RecipientPermission -Identity 'noreply@company.com' -Trustee 'serviceaccount@company.com' -AccessRights SendAs",
      powershell: 'Add-RecipientPermission -Identity "noreply@company.com" -Trustee "serviceaccount@company.com" -AccessRights SendAs -Confirm:$false',
      adobeDocUrl: "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/oauth2-support-for-mail-service",
      msDocUrl: "https://learn.microsoft.com/en-us/exchange/recipients-in-exchange-online/manage-permissions-for-recipients",
    },
    {
      name: "Send on Behalf",
      description:
        "The recipient sees 'serviceaccount@company.com on behalf of noreply@company.com'. " +
        "Less clean but requires fewer permissions.",
      how: "Exchange Online Admin Center → Recipients → Mailboxes → select the From mailbox → Delegation → Send on Behalf → add the service account. " +
        "Or via PowerShell: Set-Mailbox -Identity 'noreply@company.com' -GrantSendOnBehalfTo 'serviceaccount@company.com'",
      powershell: 'Set-Mailbox -Identity "noreply@company.com" -GrantSendOnBehalfTo "serviceaccount@company.com"',
      adobeDocUrl: "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/oauth2-support-for-mail-service",
      msDocUrl: "https://learn.microsoft.com/en-us/microsoft-365/admin/add-users/give-mailbox-permissions-to-another-user",
    },
    {
      name: "Shared Mailbox",
      description:
        "Create noreply@company.com as a shared mailbox. Grant the service account Full Access + Send As. " +
        "No license required for the shared mailbox. Best practice for noreply-style addresses.",
      how: "Microsoft 365 Admin Center → Teams & groups → Shared mailboxes → Add → create noreply@company.com. " +
        "Then add the service account as a member with Send As permissions.",
      powershell:
        'New-Mailbox -Shared -Name "noreply" -PrimarySmtpAddress "noreply@company.com"\n' +
        'Add-RecipientPermission -Identity "noreply@company.com" -Trustee "serviceaccount@company.com" -AccessRights SendAs -Confirm:$false\n' +
        'Add-MailboxPermission -Identity "noreply@company.com" -User "serviceaccount@company.com" -AccessRights FullAccess -AutoMapping $false',
      adobeDocUrl: "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/oauth2-support-for-mail-service",
      msDocUrl: "https://learn.microsoft.com/en-us/microsoft-365/admin/email/about-shared-mailboxes",
    },
    {
      name: "Match From to smtp.user",
      description:
        "Simplest option: set from.address to the same as smtp.user in AEM config. " +
        "No extra Exchange permissions needed.",
      how: 'In DefaultMailService.cfg.json, set from.address to the same value as smtp.user (e.g., "serviceaccount@company.com").',
      adobeDocUrl: "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/oauth2-support-for-mail-service",
    },
  ],

  recommendation:
    "For production noreply@ addresses, the Shared Mailbox + Send As approach is recommended by Microsoft. " +
    "It requires no user license, keeps credentials separate, and the recipient sees clean From headers. " +
    "For quick testing, matching from.address to smtp.user eliminates this variable entirely.",
} as const;

/** Required scopes per Adobe documentation */
export const REQUIRED_SCOPES = [
  "https://outlook.office.com/SMTP.Send",
  "offline_access",
  "openid",
  "email",
  "profile",
] as const;

/** Scopes that are critical (FAIL if missing) vs recommended (WARN if missing) */
export const CRITICAL_SCOPES = [
  "https://outlook.office.com/SMTP.Send",
  "offline_access",
] as const;

export const RECOMMENDED_SCOPES = ["openid", "email", "profile"] as const;
