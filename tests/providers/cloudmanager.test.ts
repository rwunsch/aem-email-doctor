import { describe, it, expect, vi, afterEach } from "vitest";
import { promisify } from "node:util";

let mockResult: string | Error = "";

vi.mock("node:child_process", () => {
  const fn = Object.assign(
    (_cmd: string, _args: any, _opts: any, cb?: any) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      if (callback) {
        process.nextTick(() => {
          if (mockResult instanceof Error) {
            callback(mockResult, "", mockResult.message);
          } else {
            callback(null, mockResult, "");
          }
        });
      }
      return {} as any;
    },
    {
      [promisify.custom]: (..._args: any[]) => {
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          process.nextTick(() => {
            if (mockResult instanceof Error) {
              reject(mockResult);
            } else {
              resolve({ stdout: mockResult as string, stderr: "" });
            }
          });
        });
      },
    }
  );
  return { execFile: fn };
});

const { listEnvironmentVariables } = await import("../../src/providers/cloudmanager.js");

describe("listEnvironmentVariables", () => {
  afterEach(() => {
    mockResult = "";
  });

  it("returns PASS when both OAuth secrets are present", async () => {
    mockResult = JSON.stringify([
      { name: "SECRET_SMTP_OAUTH_CLIENT_SECRET", type: "secretString" },
      { name: "SECRET_SMTP_OAUTH_REFRESH_TOKEN", type: "secretString" },
      { name: "EMAIL_USERNAME", type: "string", value: "noreply@example.com" },
    ]);

    const { variables, findings } = await listEnvironmentVariables("p12345", "e67890");
    expect(variables).toHaveLength(3);

    const secretsFinding = findings.find((f) => f.id === "CM_SECRETS_SET");
    expect(secretsFinding!.severity).toBe("pass");
  });

  it("returns FAIL when client secret is missing", async () => {
    mockResult = JSON.stringify([
      { name: "SECRET_SMTP_OAUTH_REFRESH_TOKEN", type: "secretString" },
    ]);

    const { findings } = await listEnvironmentVariables("p12345", "e67890");
    const secretsFinding = findings.find((f) => f.id === "CM_SECRETS_SET");
    expect(secretsFinding!.severity).toBe("fail");
    expect(secretsFinding!.detail).toContain("Client secret: MISSING");
  });

  it("returns FAIL when refresh token is missing", async () => {
    mockResult = JSON.stringify([
      { name: "SECRET_SMTP_OAUTH_CLIENT_SECRET", type: "secretString" },
    ]);

    const { findings } = await listEnvironmentVariables("p12345", "e67890");
    const secretsFinding = findings.find((f) => f.id === "CM_SECRETS_SET");
    expect(secretsFinding!.severity).toBe("fail");
    expect(secretsFinding!.detail).toContain("Refresh token: MISSING");
  });

  it("returns PASS for EMAIL_USERNAME when present", async () => {
    mockResult = JSON.stringify([
      { name: "SECRET_SMTP_OAUTH_CLIENT_SECRET", type: "secretString" },
      { name: "SECRET_SMTP_OAUTH_REFRESH_TOKEN", type: "secretString" },
      { name: "EMAIL_USERNAME", type: "string", value: "noreply@example.com" },
    ]);

    const { findings } = await listEnvironmentVariables("p12345", "e67890");
    const envFinding = findings.find((f) => f.id === "CM_ENV_VARS_SET");
    expect(envFinding!.severity).toBe("pass");
  });

  it("returns WARN for EMAIL_USERNAME when not present", async () => {
    mockResult = JSON.stringify([
      { name: "SECRET_SMTP_OAUTH_CLIENT_SECRET", type: "secretString" },
      { name: "SECRET_SMTP_OAUTH_REFRESH_TOKEN", type: "secretString" },
    ]);

    const { findings } = await listEnvironmentVariables("p12345", "e67890");
    const envFinding = findings.find((f) => f.id === "CM_ENV_VARS_SET");
    expect(envFinding!.severity).toBe("warn");
  });

  it("handles aio CLI errors with FAIL finding", async () => {
    mockResult = new Error("aio: auth required");

    const { variables, findings } = await listEnvironmentVariables("p12345", "e67890");
    expect(variables).toHaveLength(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("fail");
    expect(findings[0].fix).toContain("aio login");
  });

  it("handles empty variable list", async () => {
    mockResult = JSON.stringify([]);

    const { findings } = await listEnvironmentVariables("p12345", "e67890");
    const secretsFinding = findings.find((f) => f.id === "CM_SECRETS_SET");
    expect(secretsFinding!.severity).toBe("fail");
  });
});
