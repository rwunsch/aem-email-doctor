import { describe, it, expect, vi, afterEach } from "vitest";
import { promisify } from "node:util";

let mockResult: string | Error = "";

vi.mock("node:child_process", () => {
  // execFile needs [util.promisify.custom] so promisify returns { stdout, stderr }
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

const { checkAppRegistration } = await import("../../src/providers/azure.js");

describe("checkAppRegistration", () => {
  afterEach(() => {
    mockResult = "";
  });

  it("returns PASS finding when app registration is found", async () => {
    mockResult = JSON.stringify({
      displayName: "AEM Email App",
      web: { redirectUris: ["http://localhost", "http://localhost:8080"] },
    });

    const findings = await checkAppRegistration("11111111-2222-3333-4444-555555555555");

    const appFinding = findings.find((f) => f.id === "AZURE_APP_EXISTS");
    expect(appFinding).toBeDefined();
    expect(appFinding!.severity).toBe("pass");
    expect(appFinding!.title).toContain("11111111-2222-3333-4444-555555555555");
  });

  it("returns PASS for redirect URIs that include localhost", async () => {
    mockResult = JSON.stringify({
      displayName: "AEM Email App",
      web: { redirectUris: ["http://localhost:8080", "https://example.com/cb"] },
    });

    const findings = await checkAppRegistration("client-id");
    const uriFinding = findings.find((f) => f.id === "AZURE_REDIRECT_URIS");
    expect(uriFinding!.severity).toBe("pass");
  });

  it("returns WARN when no localhost redirect URI", async () => {
    mockResult = JSON.stringify({
      displayName: "AEM Email App",
      web: { redirectUris: ["https://example.com/callback"] },
    });

    const findings = await checkAppRegistration("client-id");
    const uriFinding = findings.find((f) => f.id === "AZURE_REDIRECT_URIS");
    expect(uriFinding!.severity).toBe("warn");
    expect(uriFinding!.fix).toContain("localhost");
  });

  it("handles missing web.redirectUris gracefully", async () => {
    mockResult = JSON.stringify({ displayName: "No Web App" });

    const findings = await checkAppRegistration("client-id");
    const uriFinding = findings.find((f) => f.id === "AZURE_REDIRECT_URIS");
    expect(uriFinding!.severity).toBe("warn");
  });

  it("returns FAIL when az CLI fails", async () => {
    mockResult = new Error("az: command not found");

    const findings = await checkAppRegistration("client-id");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("AZURE_APP_EXISTS");
    expect(findings[0].severity).toBe("fail");
    expect(findings[0].fix).toContain("az login");
  });

  it("includes app display name in finding detail", async () => {
    mockResult = JSON.stringify({
      displayName: "My AEM Mailer",
      web: { redirectUris: ["http://localhost"] },
    });

    const findings = await checkAppRegistration("client-id");
    const appFinding = findings.find((f) => f.id === "AZURE_APP_EXISTS");
    expect(appFinding!.detail).toContain("My AEM Mailer");
  });
});
