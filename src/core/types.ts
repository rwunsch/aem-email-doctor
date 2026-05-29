export enum Severity {
  PASS = "pass",
  WARN = "warn",
  FAIL = "fail",
  SKIP = "skip",
}

export enum CheckStep {
  COLLECT_CONFIG = 1,
  VALIDATE_CONFIG = 2,
  TEST_OAUTH2 = 3,
  TEST_SMTP = 4,
  CHECK_AEM_CONFIG = 5,
  VERIFY_AEM_RUNTIME = 6,
  AZURE_DEEP_DIVE = 7,
  REPORT = 8,
}

export interface FixAction {
  type: "generate-config" | "set-cm-var" | "copy-command";
  payload: Record<string, unknown>;
}

export interface Finding {
  id: string;
  step: CheckStep;
  severity: Severity;
  title: string;
  detail: string;
  fix?: string;
  fixAction?: FixAction;
  evidence?: string;
  docUrl?: string;
  msDocUrl?: string;
}

export interface EmailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
  fromAddress: string;
  smtpPort: number;
  redirectUri: string;
  scopes: string[];
  testRecipient?: string;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export interface SmtpTestResult {
  connected: boolean;
  starttls: boolean;
  authenticated: boolean;
  emailSent: boolean;
  transcript: string[];
  error?: string;
}

export interface ProviderStatus {
  core: boolean;
  cloudManager: boolean;
  aem: boolean;
  azure: boolean;
}

export interface ReportSummary {
  pass: number;
  fail: number;
  warn: number;
  skip: number;
  total: number;
}

export interface DiagnosticReport {
  timestamp: string;
  findings: Finding[];
  summary: ReportSummary;
  tiers: ProviderStatus;
  tokenResult?: TokenResult;
  smtpResult?: SmtpTestResult;
}

export type CheckFn = (config: EmailConfig) => Finding | Promise<Finding>;

export function createFinding(
  params: Omit<Finding, "fixAction" | "evidence" | "msDocUrl"> & {
    fixAction?: FixAction;
    evidence?: string;
    msDocUrl?: string;
  }
): Finding {
  return {
    id: params.id,
    step: params.step,
    severity: params.severity,
    title: params.title,
    detail: params.detail,
    fix: params.fix,
    fixAction: params.fixAction,
    evidence: params.evidence,
    docUrl: params.docUrl,
    msDocUrl: params.msDocUrl,
  };
}
