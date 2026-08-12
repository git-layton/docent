#!/usr/bin/env node
// Run a command with a WORKING Rust toolchain on PATH.
//
// Why this exists: `~/.cargo/bin/cargo` on this machine is a symlink to `rustup`, and the
// rustup binary is gone. Worse, the symlinks are recreated by the build itself — repaired on
// Jul 21, reverted Aug 6 at 11:14 (mid `tauri build`), repaired Aug 5, reverted again — so
// hand-fixing them is treating a symptom that the next build reintroduces. The failure it
// produces is opaque:
//
//   failed to run 'cargo metadata' command: No such file or directory (os error 2)
//
// The real toolchain under ~/.rustup/toolchains is intact throughout. This finds it and puts
// it FIRST on PATH, so builds stop depending on the shim layer entirely.
//
// Note both must be on PATH, not just cargo: cargo shells out to `rustc` BY NAME, so invoking
// the toolchain's cargo directly still fails with "could not execute process `rustc -vV`".

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A toolchain bin dir containing a real cargo AND rustc, or null. */
function findToolchainBin() {
  // An already-working cargo on PATH wins — never override a healthy setup.
  const probe = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) return null;

  const root = join(homedir(), '.rustup', 'toolchains');
  if (!existsSync(root)) return null;

  const candidates = readdirSync(root)
    // Prefer the host triple, then anything stable, then whatever exists.
    .sort((a, b) => Number(b.includes('stable')) - Number(a.includes('stable')))
    .map(name => join(root, name, 'bin'))
    .filter(bin => existsSync(join(bin, 'cargo')) && existsSync(join(bin, 'rustc')));

  return candidates[0] ?? null;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/with-rust.mjs <command> [args…]');
  process.exit(2);
}

const bin = findToolchainBin();
const env = { ...process.env };
if (bin) {
  env.PATH = `${bin}:${env.PATH ?? ''}`;
  console.log(`[with-rust] using toolchain at ${bin}`);
} else if (spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error(
    '[with-rust] no working Rust toolchain found.\n' +
    '  Neither `cargo` on PATH nor a toolchain under ~/.rustup/toolchains has a usable cargo+rustc.\n' +
    '  Install Rust (https://rustup.rs) or repair ~/.rustup.',
  );
  process.exit(1);
}

const res = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(res.status ?? 1);
