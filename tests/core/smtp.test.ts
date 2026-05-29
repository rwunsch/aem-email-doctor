import { describe, it, expect } from "vitest";
import {
  buildSmtpCommand,
  parseSmtpResponse,
} from "../../src/core/smtp.js";

describe("buildSmtpCommand", () => {
  it("formats a simple EHLO command", () => {
    expect(buildSmtpCommand("EHLO", "aem-email-doctor")).toBe("EHLO aem-email-doctor\r\n");
  });

  it("formats MAIL FROM with angle brackets", () => {
    expect(buildSmtpCommand("MAIL FROM", "<user@example.com>")).toBe(
      "MAIL FROM:<user@example.com>\r\n"
    );
  });

  it("formats RCPT TO with angle brackets", () => {
    expect(buildSmtpCommand("RCPT TO", "<recipient@example.com>")).toBe(
      "RCPT TO:<recipient@example.com>\r\n"
    );
  });

  it("formats AUTH XOAUTH2 with space before token", () => {
    expect(buildSmtpCommand("AUTH XOAUTH2", "base64token")).toBe(
      "AUTH XOAUTH2 base64token\r\n"
    );
  });

  it("formats a command with no argument", () => {
    expect(buildSmtpCommand("QUIT")).toBe("QUIT\r\n");
  });

  it("formats STARTTLS with no argument", () => {
    expect(buildSmtpCommand("STARTTLS")).toBe("STARTTLS\r\n");
  });

  it("formats DATA with no argument", () => {
    expect(buildSmtpCommand("DATA")).toBe("DATA\r\n");
  });

  it("formats MAIL FROM where arg lacks angle brackets — adds them", () => {
    // When called with a bare email, MAIL FROM and RCPT TO auto-wrap in <>
    expect(buildSmtpCommand("MAIL FROM", "user@example.com")).toBe(
      "MAIL FROM:<user@example.com>\r\n"
    );
  });

  it("formats RCPT TO where arg lacks angle brackets — adds them", () => {
    expect(buildSmtpCommand("RCPT TO", "recipient@example.com")).toBe(
      "RCPT TO:<recipient@example.com>\r\n"
    );
  });
});

describe("parseSmtpResponse", () => {
  it("parses a 220 greeting line", () => {
    const result = parseSmtpResponse("220 smtp.office365.com Microsoft ESMTP MAIL Service ready");
    expect(result.code).toBe(220);
    expect(result.success).toBe(true);
    expect(result.isMultiline).toBe(false);
    expect(result.message).toContain("smtp.office365.com");
  });

  it("parses a 235 authentication successful response", () => {
    const result = parseSmtpResponse("235 2.7.0 Authentication successful");
    expect(result.code).toBe(235);
    expect(result.success).toBe(true);
    expect(result.isMultiline).toBe(false);
  });

  it("parses a 535 authentication unsuccessful response", () => {
    const result = parseSmtpResponse("535 5.7.3 Authentication unsuccessful");
    expect(result.code).toBe(535);
    expect(result.success).toBe(false);
    expect(result.isMultiline).toBe(false);
  });

  it("detects multiline responses (dash after code)", () => {
    const result = parseSmtpResponse("250-smtp.office365.com Hello [1.2.3.4]");
    expect(result.code).toBe(250);
    expect(result.isMultiline).toBe(true);
  });

  it("parses final line of multiline response (space after code)", () => {
    const result = parseSmtpResponse("250 OK");
    expect(result.code).toBe(250);
    expect(result.isMultiline).toBe(false);
    expect(result.success).toBe(true);
  });

  it("treats codes >= 400 as failures", () => {
    const result = parseSmtpResponse("421 Service not available");
    expect(result.code).toBe(421);
    expect(result.success).toBe(false);
  });

  it("treats codes < 400 as success", () => {
    const result = parseSmtpResponse("334 ");
    expect(result.code).toBe(334);
    expect(result.success).toBe(true);
  });

  it("includes the message text", () => {
    const result = parseSmtpResponse("535 5.7.139 Authentication unsuccessful");
    expect(result.message).toBe("5.7.139 Authentication unsuccessful");
  });
});
