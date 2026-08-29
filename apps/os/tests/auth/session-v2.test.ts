// Layer A — SESSION v2 AND PER-USER CREDENTIALS (2F steps 6–7).
//
// The session now says WHO. These tests exist to prove it says nothing more — no role, no
// organization, nothing an attacker could rewrite into authority.

import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE, SESSION_TTL_MS, createSessionToken, readAuthConfig, verifySessionToken,
} from "@/lib/auth";
import { hashPassword, verifyPassword, burnVerification, CredentialError } from "@/core/auth/credentials";

const config = { configured: true as const, secret: "test-secret-do-not-use" };
const other = { configured: true as const, secret: "a-different-secret" };
const USER = "0198f3a1-2b4c-7d8e-9f01-234567890abc";

describe("session v2 — the token identifies a user and grants nothing", () => {
  it("round-trips the user id", async () => {
    const t = (await createSessionToken(config, USER))!;
    expect(await verifySessionToken(t, config)).toEqual({ userId: USER });
  });

  it("carries NO role and NO organization — not ignored, ABSENT", async () => {
    const t = (await createSessionToken(config, USER))!;
    // The holder can read the whole token; what matters is what is not in it to rewrite.
    expect(t).not.toMatch(/owner|sales|role|organi/i);
    const identity = await verifySessionToken(t, config);
    expect(Object.keys(identity!)).toEqual(["userId"]);
  });

  it("REJECTS a v1 token outright — it names nobody", async () => {
    // The old format: `v1.<expiry>.<sig>`. Even correctly shaped, it must not authenticate.
    const exp = Date.now() + SESSION_TTL_MS;
    expect(await verifySessionToken(`v1.${exp}.whatever`, config)).toBeNull();
  });

  it("REJECTS a tampered user id — the id is inside the signature", async () => {
    const t = (await createSessionToken(config, USER))!;
    const parts = t.split(".");
    const forged = ["v2", "00000000-0000-4000-8000-000000000000", parts[2], parts[3]].join(".");
    expect(await verifySessionToken(forged, config), "a forged user_id authenticated").toBeNull();
  });

  it("REJECTS a tampered expiry", async () => {
    const t = (await createSessionToken(config, USER))!;
    const p = t.split(".");
    expect(await verifySessionToken(`v2.${p[1]}.${Number(p[2]) + 86_400_000}.${p[3]}`, config)).toBeNull();
  });

  it("REJECTS a token signed with a different secret", async () => {
    const t = (await createSessionToken(other, USER))!;
    expect(await verifySessionToken(t, config)).toBeNull();
  });

  it("REJECTS an expired token", async () => {
    const t = (await createSessionToken(config, USER, Date.now() - SESSION_TTL_MS - 1000))!;
    expect(await verifySessionToken(t, config)).toBeNull();
  });

  it("REJECTS malformed input without throwing", async () => {
    for (const bad of [undefined, "", "...", "v2", "v2.a.b", "v2.a.b.c.d", "🙂", "v2..0.x"]) {
      expect(await verifySessionToken(bad as string | undefined, config)).toBeNull();
    }
  });

  it("FAILS CLOSED when the perimeter is unconfigured", async () => {
    const un = { configured: false as const, missing: ["ASCEND_OS_SESSION_SECRET"] };
    expect(await createSessionToken(un, USER)).toBeNull();
    const t = (await createSessionToken(config, USER))!;
    expect(await verifySessionToken(t, un)).toBeNull();
  });

  it("refuses a user id that would make the token ambiguous to parse", async () => {
    expect(await createSessionToken(config, "has.a.dot")).toBeNull();
    expect(await createSessionToken(config, "")).toBeNull();
  });

  it("readAuthConfig no longer accepts a shared password", () => {
    const saved = process.env.ASCEND_OS_SESSION_SECRET;
    process.env.ASCEND_OS_SESSION_SECRET = "x";
    const c = readAuthConfig();
    expect(c.configured).toBe(true);
    // The SHAPE proves the removal: there is nowhere left to put a shared password.
    expect(Object.keys(c).sort()).toEqual(["configured", "secret"]);
    delete process.env.ASCEND_OS_SESSION_SECRET;
    expect(readAuthConfig().configured).toBe(false);
    if (saved !== undefined) process.env.ASCEND_OS_SESSION_SECRET = saved;
  });

  it("the cookie name is unchanged", () => expect(SESSION_COOKIE).toBe("ascend_os_session"));
});

describe("credentials — scrypt, per user", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const { hash, algo } = await hashPassword("correct horse battery staple");
    expect(algo).toMatch(/^scrypt\$\d+\$\d+\$\d+$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
  }, 30_000);

  it("salts per credential — identical passwords produce different hashes", async () => {
    const a = await hashPassword("the same password");
    const b = await hashPassword("the same password");
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword("the same password", a.hash)).toBe(true);
    expect(await verifyPassword("the same password", b.hash)).toBe(true);
  }, 60_000);

  it("records its parameters, so cost can be raised without invalidating old rows", async () => {
    const { hash } = await hashPassword("some password here");
    expect(hash.split("$").slice(0, 4).join("$")).toMatch(/^scrypt\$\d+\$\d+\$\d+$/);
  }, 30_000);

  it("NEVER THROWS on a malformed or hostile stored value", async () => {
    // A corrupted row must be a failed login, not a 500 — and not a way to tell a broken row from a
    // wrong password. The absurd-parameter case also stops a tampered row demanding gigabytes.
    for (const bad of ["", "garbage", "scrypt$x$y$z$a$b", "scrypt$99999999$99$99$AAAA$BBBB",
                       "bcrypt$1$2$3$4$5", "scrypt$32768$8$1$$", "$$$$$"]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
  }, 60_000);

  it("refuses to hash a password too short to be worth hashing", async () => {
    await expect(hashPassword("short")).rejects.toThrow(CredentialError);
  });

  it("burnVerification completes, so an unknown user costs what a real one costs", async () => {
    // Deliberately not a timing assertion — those are flaky. It asserts the work happens at all.
    await expect(burnVerification("anything")).resolves.toBeUndefined();
  }, 30_000);
});
