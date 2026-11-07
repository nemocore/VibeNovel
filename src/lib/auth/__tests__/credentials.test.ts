import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthEnv, verifyCredentials } from "@/lib/auth/credentials";
import { AppError } from "@/lib/errors";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credentials", () => {
  it("reads and compares values from the environment", () => {
    vi.stubEnv("APP_USERNAME", "writer");
    vi.stubEnv("APP_PASSWORD", "test#password");

    expect(getAuthEnv()).toEqual({
      username: "writer",
      password: "test#password",
      configured: true,
    });
    expect(verifyCredentials("writer", "test#password")).toBe(true);
  });

  it("rejects a wrong username or password", () => {
    vi.stubEnv("APP_USERNAME", "writer");
    vi.stubEnv("APP_PASSWORD", "test#password");

    expect(verifyCredentials("Writer", "test#password")).toBe(false);
    expect(verifyCredentials("writer", "writer")).toBe(false);
    expect(verifyCredentials("writer", "test#password ")).toBe(false);
  });

  it("reports missing configuration instead of rejecting credentials", () => {
    vi.stubEnv("APP_USERNAME", "");
    vi.stubEnv("APP_PASSWORD", "");

    expect(() => verifyCredentials("writer", "anything")).toThrow(AppError);
    try {
      verifyCredentials("writer", "anything");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(503);
    }
  });
});
