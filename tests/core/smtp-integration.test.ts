import { describe, it, expect, vi, afterEach } from "vitest";
import * as net from "node:net";
import { EmailConfig } from "../../src/core/types.js";
import { buildSmtpCommand, parseSmtpResponse } from "../../src/core/smtp.js";

function makeConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    tenantId: "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
    clientId: "11111111-2222-3333-4444-555555555555",
    clientSecret: "test-secret-value",
    mailbox: "service-account@contoso.com",
    fromAddress: "service-account@contoso.com",
    smtpPort: 587,
    redirectUri: "http://localhost:8080",
    scopes: ["https://outlook.office.com/SMTP.Send", "offline_access"],
    testRecipient: "recipient@example.com",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Extended SMTP parsing and command building tests (beyond smtp.test.ts)
// These cover edge cases and integration-relevant scenarios.
// ---------------------------------------------------------------------------

describe("parseSmtpResponse — extended edge cases", () => {
  it("classifies 535 5.7.3 responses as failures", () => {
    const resp = parseSmtpResponse("535 5.7.3 Authentication unsuccessful");
    expect(resp.code).toBe(535);
    expect(resp.success).toBe(false);
  });

  it("classifies 535 5.7.139 (SMTP AUTH disabled) as failure", () => {
    const resp = parseSmtpResponse("535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled");
    expect(resp.code).toBe(535);
    expect(resp.success).toBe(false);
    expect(resp.message).toContain("SmtpClientAuthentication is disabled");
  });

  it("classifies 235 as authentication success", () => {
    const resp = parseSmtpResponse("235 2.7.0 Authentication successful");
    expect(resp.success).toBe(true);
    expect(resp.code).toBe(235);
  });

  it("handles 220 greeting", () => {
    const resp = parseSmtpResponse("220 smtp.office365.com Microsoft ESMTP MAIL Service ready");
    expect(resp.code).toBe(220);
    expect(resp.success).toBe(true);
    expect(resp.message).toContain("smtp.office365.com");
  });

  it("handles 220 STARTTLS ready", () => {
    const resp = parseSmtpResponse("220 2.0.0 SMTP server ready");
    expect(resp.code).toBe(220);
    expect(resp.success).toBe(true);
  });

  it("handles 454 TLS unavailable", () => {
    const resp = parseSmtpResponse("454 TLS not available due to temporary reason");
    expect(resp.code).toBe(454);
    expect(resp.success).toBe(false);
  });

  it("handles 334 challenge (used in some auth flows)", () => {
    const resp = parseSmtpResponse("334 ");
    expect(resp.success).toBe(true);
  });

  it("handles 354 DATA start", () => {
    const resp = parseSmtpResponse("354 Start mail input; end with <CRLF>.<CRLF>");
    expect(resp.code).toBe(354);
    expect(resp.success).toBe(true);
  });

  it("handles 250 after DATA (message queued)", () => {
    const resp = parseSmtpResponse("250 2.0.0 Ok: queued as ABC123");
    expect(resp.code).toBe(250);
    expect(resp.success).toBe(true);
  });

  it("handles 550 recipient rejected", () => {
    const resp = parseSmtpResponse("550 5.1.1 User unknown");
    expect(resp.code).toBe(550);
    expect(resp.success).toBe(false);
  });

  it("handles 421 service unavailable (rate limiting)", () => {
    const resp = parseSmtpResponse("421 4.7.0 Too many connections from your IP");
    expect(resp.code).toBe(421);
    expect(resp.success).toBe(false);
  });

  it("detects multiline continuation", () => {
    expect(parseSmtpResponse("250-SIZE 36700160").isMultiline).toBe(true);
    expect(parseSmtpResponse("250-8BITMIME").isMultiline).toBe(true);
    expect(parseSmtpResponse("250 SMTPUTF8").isMultiline).toBe(false);
  });
});

describe("buildSmtpCommand — extended cases", () => {
  it("builds AUTH XOAUTH2 with base64 token", () => {
    const token = Buffer.from("user=u@e.com\x01auth=Bearer tok\x01\x01").toString("base64");
    const cmd = buildSmtpCommand("AUTH XOAUTH2", token);
    expect(cmd).toContain("AUTH XOAUTH2 ");
    expect(cmd).toContain(token);
    expect(cmd.endsWith("\r\n")).toBe(true);
  });

  it("builds RCPT TO with angle brackets for bare email", () => {
    expect(buildSmtpCommand("RCPT TO", "test@example.com")).toBe("RCPT TO:<test@example.com>\r\n");
  });

  it("preserves existing angle brackets in MAIL FROM", () => {
    expect(buildSmtpCommand("MAIL FROM", "<user@x.com>")).toBe("MAIL FROM:<user@x.com>\r\n");
  });

  it("handles DATA command without args", () => {
    expect(buildSmtpCommand("DATA")).toBe("DATA\r\n");
  });

  it("handles NOOP command", () => {
    expect(buildSmtpCommand("NOOP")).toBe("NOOP\r\n");
  });

  it("handles RSET command", () => {
    expect(buildSmtpCommand("RSET")).toBe("RSET\r\n");
  });
});

// ---------------------------------------------------------------------------
// Test with a real local mock SMTP server
// ---------------------------------------------------------------------------

describe("mock SMTP server integration", () => {
  let server: net.Server | undefined;

  function startMockSmtp(handler: (line: string, socket: net.Socket) => void): Promise<number> {
    return new Promise((resolve) => {
      server = net.createServer((socket) => {
        socket.write("220 mock.smtp.test ready\r\n");
        let buffer = "";
        socket.on("data", (data) => {
          buffer += data.toString();
          while (buffer.includes("\r\n")) {
            const idx = buffer.indexOf("\r\n");
            const line = buffer.substring(0, idx);
            buffer = buffer.substring(idx + 2);
            handler(line, socket);
          }
        });
      });
      server.listen(0, "127.0.0.1", () => {
        resolve((server!.address() as net.AddressInfo).port);
      });
    });
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
  });

  it("receives EHLO and responds with 250", async () => {
    const port = await startMockSmtp((line, socket) => {
      if (line.startsWith("EHLO")) {
        socket.write("250-mock.smtp.test Hello\r\n250 OK\r\n");
      } else if (line === "QUIT") {
        socket.write("221 Bye\r\n");
        socket.end();
      }
    });

    const socket = net.createConnection({ host: "127.0.0.1", port });
    const greeting = await new Promise<string>((resolve) => {
      socket.once("data", (d) => resolve(d.toString()));
    });
    expect(greeting).toContain("220");

    socket.write("EHLO test-client\r\n");
    const ehlo = await new Promise<string>((resolve) => {
      socket.once("data", (d) => resolve(d.toString()));
    });
    expect(ehlo).toContain("250");
    expect(ehlo).toContain("Hello");

    socket.write("QUIT\r\n");
    socket.destroy();
  });

  it("handles AUTH XOAUTH2 and responds", async () => {
    let receivedAuth = "";
    const port = await startMockSmtp((line, socket) => {
      if (line.startsWith("EHLO")) {
        socket.write("250 OK\r\n");
      } else if (line.startsWith("AUTH XOAUTH2")) {
        receivedAuth = line;
        socket.write("235 2.7.0 Authentication successful\r\n");
      } else if (line === "QUIT") {
        socket.write("221 Bye\r\n");
        socket.end();
      }
    });

    const socket = net.createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((resolve) => socket.once("data", () => resolve())); // greeting

    socket.write("EHLO test\r\n");
    await new Promise<void>((resolve) => socket.once("data", () => resolve())); // EHLO reply

    const token = Buffer.from("user=u@e.com\x01auth=Bearer mytoken\x01\x01").toString("base64");
    socket.write(`AUTH XOAUTH2 ${token}\r\n`);
    const authReply = await new Promise<string>((resolve) => {
      socket.once("data", (d) => resolve(d.toString()));
    });

    expect(authReply).toContain("235");
    expect(receivedAuth).toContain("AUTH XOAUTH2");
    expect(receivedAuth).toContain(token);

    socket.write("QUIT\r\n");
    socket.destroy();
  });

  it("rejects invalid AUTH with 535 error", async () => {
    const port = await startMockSmtp((line, socket) => {
      if (line.startsWith("EHLO")) {
        socket.write("250 OK\r\n");
      } else if (line.startsWith("AUTH XOAUTH2")) {
        socket.write("535 5.7.3 Authentication unsuccessful\r\n");
      } else if (line === "QUIT") {
        socket.write("221 Bye\r\n");
        socket.end();
      }
    });

    const socket = net.createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((resolve) => socket.once("data", () => resolve())); // greeting

    socket.write("EHLO test\r\n");
    await new Promise<void>((resolve) => socket.once("data", () => resolve()));

    socket.write("AUTH XOAUTH2 badtoken\r\n");
    const authReply = await new Promise<string>((resolve) => {
      socket.once("data", (d) => resolve(d.toString()));
    });

    expect(authReply).toContain("535");
    const parsed = parseSmtpResponse(authReply.trim());
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe(535);

    socket.write("QUIT\r\n");
    socket.destroy();
  });

  it("handles full MAIL FROM → RCPT TO → DATA → QUIT flow", async () => {
    const port = await startMockSmtp((line, socket) => {
      if (line.startsWith("EHLO")) socket.write("250 OK\r\n");
      else if (line.startsWith("AUTH")) socket.write("235 OK\r\n");
      else if (line.startsWith("MAIL FROM")) socket.write("250 2.1.0 Ok\r\n");
      else if (line.startsWith("RCPT TO")) socket.write("250 2.1.5 Ok\r\n");
      else if (line === "DATA") socket.write("354 Start mail input\r\n");
      else if (line === ".") socket.write("250 2.0.0 Ok: queued\r\n");
      else if (line === "QUIT") { socket.write("221 Bye\r\n"); socket.end(); }
    });

    const socket = net.createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((r) => socket.once("data", () => r())); // greeting

    // EHLO
    socket.write("EHLO test\r\n");
    await new Promise<void>((r) => socket.once("data", () => r()));

    // AUTH
    socket.write("AUTH XOAUTH2 token\r\n");
    const authReply = await new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    expect(parseSmtpResponse(authReply.trim()).success).toBe(true);

    // MAIL FROM
    socket.write(buildSmtpCommand("MAIL FROM", "sender@example.com"));
    const mailReply = await new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    expect(parseSmtpResponse(mailReply.trim()).code).toBe(250);

    // RCPT TO
    socket.write(buildSmtpCommand("RCPT TO", "recipient@example.com"));
    const rcptReply = await new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    expect(parseSmtpResponse(rcptReply.trim()).code).toBe(250);

    // DATA
    socket.write("DATA\r\n");
    const dataReply = await new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    expect(parseSmtpResponse(dataReply.trim()).code).toBe(354);

    // Message body
    socket.write("Subject: Test\r\n\r\nBody\r\n.\r\n");
    const sendReply = await new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    expect(parseSmtpResponse(sendReply.trim()).code).toBe(250);

    socket.write("QUIT\r\n");
    socket.destroy();
  });
});
