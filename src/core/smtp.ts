import * as net from "node:net";
import * as tls from "node:tls";
import { EmailConfig, SmtpTestResult, Finding, Severity, CheckStep, createFinding } from "./types.js";
import { MICROSOFT_DOCS, ENTRA_ERRORS } from "./knowledge-base.js";
import { buildXOAuth2Token } from "./oauth.js";

// ---------------------------------------------------------------------------
// SMTP command builder
// ---------------------------------------------------------------------------

const COLON_VERBS = new Set(["MAIL FROM", "RCPT TO"]);

/**
 * Builds an SMTP command string terminated with CRLF.
 *
 * MAIL FROM and RCPT TO get special colon-attached formatting:
 *   MAIL FROM:<addr>\r\n
 *
 * All other verbs with an argument get a space:
 *   AUTH XOAUTH2 <token>\r\n
 */
export function buildSmtpCommand(verb: string, arg?: string): string {
  if (!arg) {
    return `${verb}\r\n`;
  }

  if (COLON_VERBS.has(verb)) {
    // Wrap in angle brackets if not already present
    const addr = arg.startsWith("<") && arg.endsWith(">") ? arg : `<${arg}>`;
    return `${verb}:${addr}\r\n`;
  }

  return `${verb} ${arg}\r\n`;
}

// ---------------------------------------------------------------------------
// SMTP response parser
// ---------------------------------------------------------------------------

export interface SmtpResponse {
  code: number;
  message: string;
  success: boolean;
  isMultiline: boolean;
}

/**
 * Parses a single SMTP response line.
 *
 * Format:  <code><sep><message>
 *   sep = '-'  → multiline continuation
 *   sep = ' '  → final line
 */
export function parseSmtpResponse(data: string): SmtpResponse {
  const line = data.trimEnd();
  const code = parseInt(line.substring(0, 3), 10);
  const sep = line[3];
  const message = line.substring(4);
  const isMultiline = sep === "-";
  const success = code < 400;

  return { code, message, success, isMultiline };
}

// ---------------------------------------------------------------------------
// SMTP test runner
// ---------------------------------------------------------------------------

export interface SmtpTestOptions {
  /** Timeout for each individual socket operation in ms. Default 10000. */
  operationTimeoutMs?: number;
  /** Whether to send a test email (requires testRecipient in config). Default false. */
  sendTestEmail?: boolean;
}

const SMTP_HOST = "smtp.office365.com";
const SMTP_PORT = 587;
const CLIENT_HOSTNAME = "aem-email-doctor";

/**
 * Runs a full SMTP test sequence:
 *   1. TCP connect
 *   2. Read server greeting
 *   3. EHLO
 *   4. STARTTLS
 *   5. TLS upgrade
 *   6. EHLO (post-TLS)
 *   7. AUTH XOAUTH2
 *   8. (Optional) Send test email
 *   9. QUIT
 */
export async function testSmtp(
  config: EmailConfig,
  accessToken: string,
  options: SmtpTestOptions = {}
): Promise<{ result: SmtpTestResult; findings: Finding[] }> {
  const { operationTimeoutMs = 10_000, sendTestEmail = false } = options;
  const transcript: string[] = [];
  const findings: Finding[] = [];

  const result: SmtpTestResult = {
    connected: false,
    starttls: false,
    authenticated: false,
    emailSent: false,
    transcript,
  };

  // Helper to add a line to transcript
  const log = (line: string) => transcript.push(line);

  // -------------------------------------------------------------------------
  // Phase 1: TCP connect and plaintext SMTP conversation
  // -------------------------------------------------------------------------
  let plainSocket: net.Socket;

  try {
    plainSocket = await connectTcp(SMTP_HOST, SMTP_PORT, operationTimeoutMs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `TCP connect failed: ${message}`;
    log(`[ERROR] ${result.error}`);
    findings.push(
      createFinding({
        id: "SMTP_CONNECT",
        step: CheckStep.TEST_SMTP,
        severity: Severity.FAIL,
        title: `Cannot reach ${SMTP_HOST}:${SMTP_PORT}`,
        detail: message,
        fix: "Check network connectivity and firewall rules. AEM CS advanced networking egress must allow smtp.office365.com:587.",
        docUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
      })
    );
    return { result, findings };
  }

  result.connected = true;
  log(`[TCP] Connected to ${SMTP_HOST}:${SMTP_PORT}`);

  findings.push(
    createFinding({
      id: "SMTP_CONNECT",
      step: CheckStep.TEST_SMTP,
      severity: Severity.PASS,
      title: `TCP connection to ${SMTP_HOST}:${SMTP_PORT} succeeded`,
      detail: "Network path to smtp.office365.com:587 is open.",
    })
  );

  // Create a line reader with shared buffer for the plaintext socket
  let reader = createLineReader(plainSocket);

  try {
    // Read greeting (220)
    const greeting = await reader.readLine(operationTimeoutMs);
    log(`S: ${greeting}`);
    const greetParsed = parseSmtpResponse(greeting);
    if (!greetParsed.success) {
      throw new Error(`Unexpected greeting: ${greeting}`);
    }

    // EHLO
    await writeLine(plainSocket, buildSmtpCommand("EHLO", CLIENT_HOSTNAME));
    log(`C: EHLO ${CLIENT_HOSTNAME}`);
    const ehloLines = await reader.readMultiline(operationTimeoutMs);
    ehloLines.forEach((l) => log(`S: ${l}`));

    // STARTTLS
    await writeLine(plainSocket, buildSmtpCommand("STARTTLS"));
    log(`C: STARTTLS`);
    const starttlsReply = await reader.readLine(operationTimeoutMs);
    log(`S: ${starttlsReply}`);
    const starttlsParsed = parseSmtpResponse(starttlsReply);

    if (!starttlsParsed.success || starttlsParsed.code !== 220) {
      throw new Error(`STARTTLS rejected: ${starttlsReply}`);
    }

    result.starttls = true;
    findings.push(
      createFinding({
        id: "SMTP_STARTTLS",
        step: CheckStep.TEST_SMTP,
        severity: Severity.PASS,
        title: "STARTTLS negotiation succeeded",
        detail: "Server accepted STARTTLS upgrade.",
        msDocUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
      })
    );

    // -----------------------------------------------------------------------
    // Phase 2: TLS upgrade
    // -----------------------------------------------------------------------
    let secureSocket: tls.TLSSocket;
    try {
      secureSocket = await upgradeTls(plainSocket, SMTP_HOST, operationTimeoutMs);
      log(`[TLS] Upgraded to TLS (${secureSocket.getCipher()?.name ?? "unknown"})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`TLS upgrade failed: ${message}`);
    }

    // Create a new line reader for the TLS socket
    reader = createLineReader(secureSocket);

    // EHLO again after TLS
    await writeLine(secureSocket, buildSmtpCommand("EHLO", CLIENT_HOSTNAME));
    log(`C: EHLO ${CLIENT_HOSTNAME} (post-TLS)`);
    const ehlo2Lines = await reader.readMultiline(operationTimeoutMs);
    ehlo2Lines.forEach((l) => log(`S: ${l}`));

    // -----------------------------------------------------------------------
    // Phase 3: AUTH XOAUTH2
    // -----------------------------------------------------------------------
    const xoauth2 = buildXOAuth2Token(config.mailbox, accessToken);
    await writeLine(secureSocket, buildSmtpCommand("AUTH XOAUTH2", xoauth2));
    log(`C: AUTH XOAUTH2 <token>`);
    const authReply = await reader.readLine(operationTimeoutMs);
    log(`S: ${authReply}`);
    const authParsed = parseSmtpResponse(authReply);

    if (!authParsed.success) {
      // Match known SMTP error codes
      const smtpErrorKey = Object.keys(ENTRA_ERRORS).find((k) =>
        authReply.includes(k)
      );
      const knowledge = smtpErrorKey ? ENTRA_ERRORS[smtpErrorKey] : undefined;

      findings.push(
        createFinding({
          id: "SMTP_XOAUTH2_AUTH",
          step: CheckStep.TEST_SMTP,
          severity: Severity.FAIL,
          title: "SMTP AUTH XOAUTH2 failed",
          detail: knowledge
            ? `${knowledge.summary} ${knowledge.likely_cause}`
            : authReply,
          fix: knowledge?.fix,
          evidence: authReply,
          msDocUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
          docUrl: MICROSOFT_DOCS.SMTP_AUTH_ENABLE,
        })
      );
      result.error = `AUTH XOAUTH2 failed: ${authReply}`;
      // Send QUIT before returning
      await writeLine(secureSocket, buildSmtpCommand("QUIT")).catch(() => {});
      secureSocket.destroy();
      return { result, findings };
    }

    result.authenticated = true;
    findings.push(
      createFinding({
        id: "SMTP_XOAUTH2_AUTH",
        step: CheckStep.TEST_SMTP,
        severity: Severity.PASS,
        title: "SMTP AUTH XOAUTH2 succeeded",
        detail: `Authenticated as ${config.mailbox} using XOAUTH2. SMTP.Send permission confirmed.`,
        msDocUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
      })
    );

    // -----------------------------------------------------------------------
    // Phase 4: Optional test email
    // -----------------------------------------------------------------------
    if (sendTestEmail && config.testRecipient) {
      try {
        await writeLine(secureSocket, buildSmtpCommand("MAIL FROM", config.fromAddress));
        log(`C: MAIL FROM:<${config.fromAddress}>`);
        const mailFromReply = await reader.readLine(operationTimeoutMs);
        log(`S: ${mailFromReply}`);

        await writeLine(secureSocket, buildSmtpCommand("RCPT TO", config.testRecipient));
        log(`C: RCPT TO:<${config.testRecipient}>`);
        const rcptReply = await reader.readLine(operationTimeoutMs);
        log(`S: ${rcptReply}`);

        await writeLine(secureSocket, buildSmtpCommand("DATA"));
        log(`C: DATA`);
        const dataReply = await reader.readLine(operationTimeoutMs);
        log(`S: ${dataReply}`);

        const timestamp = new Date().toUTCString();
        const emailBody = [
          `Date: ${timestamp}`,
          `From: ${config.fromAddress}`,
          `To: ${config.testRecipient}`,
          `Subject: AEM Email Doctor - Test Message`,
          ``,
          `This is a test message sent by aem-email-doctor to verify OAuth2 SMTP authentication.`,
          `.`,
          ``,
        ].join("\r\n");

        await writeLine(secureSocket, emailBody);
        log(`C: [email body]`);
        const sendReply = await reader.readLine(operationTimeoutMs);
        log(`S: ${sendReply}`);
        const sendParsed = parseSmtpResponse(sendReply);

        if (sendParsed.success) {
          result.emailSent = true;
          findings.push(
            createFinding({
              id: "SMTP_SEND_TEST",
              step: CheckStep.TEST_SMTP,
              severity: Severity.PASS,
              title: `Test email delivered to ${config.testRecipient}`,
              detail: `Server responded: ${sendReply}`,
            })
          );
        } else {
          findings.push(
            createFinding({
              id: "SMTP_SEND_TEST",
              step: CheckStep.TEST_SMTP,
              severity: Severity.FAIL,
              title: "Test email delivery rejected",
              detail: sendReply,
              evidence: sendReply,
              msDocUrl: MICROSOFT_DOCS.SEND_AS_PERMISSION,
            })
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        findings.push(
          createFinding({
            id: "SMTP_SEND_TEST",
            step: CheckStep.TEST_SMTP,
            severity: Severity.FAIL,
            title: "Test email send error",
            detail: message,
          })
        );
      }
    } else if (sendTestEmail && !config.testRecipient) {
      findings.push(
        createFinding({
          id: "SMTP_SEND_TEST",
          step: CheckStep.TEST_SMTP,
          severity: Severity.SKIP,
          title: "Test email skipped — no testRecipient configured",
          detail: "Set testRecipient in config to send a verification email.",
        })
      );
    }

    // QUIT
    await writeLine(secureSocket, buildSmtpCommand("QUIT"));
    log(`C: QUIT`);
    const quitReply = await reader.readLine(operationTimeoutMs).catch(() => "");
    if (quitReply) log(`S: ${quitReply}`);
    secureSocket.destroy();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!result.error) result.error = message;
    log(`[ERROR] ${message}`);
    plainSocket.destroy();

    // Add a finding for any unhandled STARTTLS-phase failure
    if (!result.starttls) {
      findings.push(
        createFinding({
          id: "SMTP_STARTTLS",
          step: CheckStep.TEST_SMTP,
          severity: Severity.FAIL,
          title: "STARTTLS failed",
          detail: message,
          msDocUrl: MICROSOFT_DOCS.SMTP_AUTH_OAUTH2,
        })
      );
    }
  }

  return { result, findings };
}

// ---------------------------------------------------------------------------
// Socket helpers
// ---------------------------------------------------------------------------

function connectTcp(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connect timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function upgradeTls(socket: net.Socket, host: string, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket,
      host,
      servername: host,
    });
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error(`TLS handshake timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    tlsSocket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(tlsSocket);
    });
    tlsSocket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Creates a line reader that maintains a shared buffer across calls.
 * This is critical because SMTP servers often send multiline responses
 * (like EHLO) in a single TCP chunk — without a shared buffer, data
 * after the first \r\n in a chunk would be lost.
 */
function createLineReader(socket: net.Socket | tls.TLSSocket) {
  let pending = "";

  function readLine(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check if we already have a complete line in the buffer
      const idx = pending.indexOf("\r\n");
      if (idx !== -1) {
        const line = pending.substring(0, idx);
        pending = pending.substring(idx + 2);
        resolve(line);
        return;
      }

      const timer = setTimeout(() => {
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
        reject(new Error(`Read timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      function onData(chunk: Buffer) {
        pending += chunk.toString();
        const lineIdx = pending.indexOf("\r\n");
        if (lineIdx !== -1) {
          clearTimeout(timer);
          socket.removeListener("data", onData);
          socket.removeListener("error", onError);
          const line = pending.substring(0, lineIdx);
          pending = pending.substring(lineIdx + 2);
          resolve(line);
        }
      }

      function onError(err: Error) {
        clearTimeout(timer);
        socket.removeListener("data", onData);
        reject(err);
      }

      socket.on("data", onData);
      socket.once("error", onError);
    });
  }

  async function readMultiline(timeoutMs: number): Promise<string[]> {
    const lines: string[] = [];
    while (true) {
      const line = await readLine(timeoutMs);
      lines.push(line);
      const parsed = parseSmtpResponse(line);
      if (!parsed.isMultiline) break;
    }
    return lines;
  }

  return { readLine, readMultiline };
}

function writeLine(
  socket: net.Socket | tls.TLSSocket,
  data: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
