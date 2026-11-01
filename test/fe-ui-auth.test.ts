import { describe, expect, it } from "vitest";
import {
  cleanName,
  friendlyAuthError,
  toSessionUser,
  validateEmail,
  validateName,
  validatePassword,
} from "../src/client/ui/auth-logic";

describe("auth form validation", () => {
  it("cleans names like the server", () => {
    expect(cleanName("  Fern ​  Moss\n")).toBe("Fern Moss");
    expect(Array.from(cleanName("x".repeat(40)))).toHaveLength(16);
    expect(validateName("Fern Moss")).not.toBeNull();
    expect(validateName("ab")).not.toBeNull();
    expect(validateName("Fern_Moss_2")).toBeNull();
    expect(validateName("   ")).not.toBeNull();
    expect(validateName("Clover")).toBeNull();
  });
  it("checks email and password", () => {
    expect(validateEmail("")).not.toBeNull();
    expect(validateEmail("nope")).not.toBeNull();
    expect(validateEmail(" a@b.co ")).toBeNull();
    expect(validatePassword("1234567")).not.toBeNull();
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("x".repeat(129))).not.toBeNull();
  });
});

describe("friendlyAuthError", () => {
  it("maps known Better Auth codes", () => {
    expect(friendlyAuthError({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "signin")).toMatch(/don't match/);
    expect(friendlyAuthError({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 }, "signup")).toMatch(/already exists/);
    expect(friendlyAuthError({ code: "VERIFICATION_FAILED", status: 403 }, "guest")).toMatch(/human check/);
    expect(friendlyAuthError({ status: 429 }, "signup")).toMatch(/Too many/);
    expect(friendlyAuthError(null, "signin")).toMatch(/reach Mossbrook/);
  });
  it("never echoes unknown server text", () => {
    const msg = friendlyAuthError({ code: "WEIRD", message: "<img src=x>", status: 400 }, "signup");
    expect(msg).not.toContain("<img");
  });
});

describe("toSessionUser", () => {
  it("marks anonymous users as guests without email", () => {
    expect(toSessionUser({ id: "u1", name: "Fern", email: "temp@anon.local", isAnonymous: true })).toEqual({
      id: "u1",
      name: "Fern",
      email: null,
      isGuest: true,
    });
    expect(toSessionUser({ id: "u2", name: "Ash", email: "a@b.co", isAnonymous: null }).isGuest).toBe(false);
  });
});
