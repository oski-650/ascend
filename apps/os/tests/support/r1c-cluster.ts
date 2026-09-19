// tests/support/r1c-cluster — a DISPOSABLE PostgreSQL cluster for the R1c same-version proof.
//
// Everything lives under one private recovery root that the owner's runner creates and destroys:
//
//   <root>/pg17/bin            the PostgreSQL build under test (official source, built into the root)
//   <root>/<name>/data         this cluster's data directory
//   <root>/<name>/sock         its ONLY listening endpoint: a Unix socket, mode 0700
//
// The server is started with `listen_addresses = ''` — no TCP listener exists — and every binary is
// invoked by absolute path with an explicit, allowlisted environment, so no inherited `PG*` variable,
// `~/.pgpass` or service file can choose where a command goes. Superuser credentials are generated
// here, written only inside the cluster directory (mode 0600), and never printed.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EphemeralLogin, EphemeralServer } from "@/core/recovery/restore";

export const R1C_SUPERUSER = "r1c_admin";

/** The only environment a PostgreSQL binary is given. Nothing that could name a server. */
function binaryEnv(root: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: root, LC_ALL: "C", LANG: "C", TZ: "UTC" } as unknown as NodeJS.ProcessEnv;
}

export type R1cCluster = {
  server: EphemeralServer;
  /** The superuser, connected to a database of the caller's choosing. */
  admin(database: string): EphemeralLogin;
  /** A libpq `passfile` holding only the superuser's line; for `pg_restore`, so no password is in argv. */
  passfile: string;
  stop(): void;
};

export function startCluster(root: string, name: string, bin: string, version: string): R1cCluster {
  const dir = join(root, name);
  const data = join(dir, "data");
  const sock = join(dir, "sock");
  if (existsSync(dir)) throw new Error(`cluster directory ${name} already exists; each leg gets a fresh cluster`);
  mkdirSync(dir, { mode: 0o700 });
  mkdirSync(sock, { mode: 0o700 });

  const password = randomBytes(32).toString("hex");
  const pwfile = join(dir, "pwfile");
  writeFileSync(pwfile, password + "\n", { mode: 0o600 });
  const passfile = join(dir, "passfile");
  writeFileSync(passfile, `*:*:*:${R1C_SUPERUSER}:${password}\n`, { mode: 0o600 });

  const env = binaryEnv(root);
  const quiet = { env, stdio: ["ignore", "ignore", "pipe"] as ("ignore" | "pipe")[] };
  execFileSync(join(bin, "initdb"), [
    "-D", data, "-U", R1C_SUPERUSER, `--pwfile=${pwfile}`, "--auth=scram-sha-256",
    "--encoding=UTF8", "--locale=C", "--no-instructions",
  ], quiet);

  let port = 0;
  do { port = randomInt(20000, 60000); } while (existsSync(join(sock, `.s.PGSQL.${port}`)));
  appendFileSync(join(data, "postgresql.conf"), [
    "",
    "# R1c: no TCP listener; one private Unix socket",
    "listen_addresses = ''",
    `unix_socket_directories = '${sock}'`,
    "unix_socket_permissions = 0700",
    `port = ${port}`,
    "",
  ].join("\n"));

  const control = execFileSync(join(bin, "pg_controldata"), ["-D", data], { env, encoding: "utf8" });
  const sysid = /Database system identifier:\s+(\d+)/.exec(control)?.[1];
  if (!sysid) throw new Error("pg_controldata reported no system identifier");

  execFileSync(join(bin, "pg_ctl"), ["-D", data, "-l", join(dir, "server.log"), "-w", "-t", "60", "start"], quiet);

  let stopped = false;
  return {
    server: { root, cluster: dir, port, version, systemIdentifier: sysid },
    admin: (database) => ({ user: R1C_SUPERUSER, password, database }),
    passfile,
    stop() {
      if (stopped) return;
      execFileSync(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "-t", "60", "stop"], quiet);
      stopped = true;
    },
  };
}

/**
 * Run a `pg_restore` binary with the archive on STDIN — the decrypted dump stays in memory and is
 * never written to disk. Returns stdout. A non-zero exit rejects with stderr (no row content: every
 * caller either lists the TOC or restores with `--exit-on-error`, whose messages name objects).
 */
export function runPgRestore(pgRestore: string, root: string, args: string[], archive: Buffer): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pgRestore, args, { env: binaryEnv(root), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8"), stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`pg_restore exited ${code}`), { stderr }));
    });
    child.stdin.on("error", () => { /* the exit code reports it */ });
    child.stdin.end(archive);
  });
}
