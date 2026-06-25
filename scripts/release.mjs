#!/usr/bin/env node
// One-command release. Bumps the version in EVERY manifest that must stay in
// sync, commits, tags, and pushes. CI (.github/workflows/release.yml) then
// builds, signs, and publishes the GitHub Release + latest.json, and installed
// copies update themselves on next launch.
//
//   npm run release -- patch          2.0.1 -> 2.0.2
//   npm run release -- minor          2.0.1 -> 2.1.0
//   npm run release -- major          2.0.1 -> 3.0.0
//   npm run release -- 2.5.0          set an explicit version
//   npm run release -- patch --dry-run   show what would happen, change nothing
//
// Why a script: the updater compares the installed app's version (from
// tauri.conf.json / Cargo.toml) against latest.json. If the manifests drift,
// the update is silently never offered. This keeps all of them identical.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const kind = args.find((a) => !a.startsWith('--'))

const die = (m) => { console.error(`\n  ✗ ${m}\n`); process.exit(1) }
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim()

if (!kind) die('Usage: npm run release -- <patch|minor|major|X.Y.Z> [--dry-run]')

// --- guards ---------------------------------------------------------------
if (sh('git rev-parse --abbrev-ref HEAD') !== 'main')
  die('Releases must be cut from the main branch.')
if (sh('git diff --cached --name-only'))
  die('You have staged changes — commit or unstage them before releasing.')

// --- compute the next version --------------------------------------------
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(ROOT + p, 'utf8')
const write = (p, s) => { if (!dryRun) writeFileSync(ROOT + p, s) }

const pkg = JSON.parse(read('package.json'))
const cur = pkg.version
const bump = (v, k) => {
  if (/^\d+\.\d+\.\d+$/.test(k)) return k
  const [a, b, c] = v.split('.').map(Number)
  if (k === 'major') return `${a + 1}.0.0`
  if (k === 'minor') return `${a}.${b + 1}.0`
  if (k === 'patch') return `${a}.${b}.${c + 1}`
  return die(`Not a bump type or version: "${k}"`)
}
const next = bump(cur, kind)
if (sh('git tag -l').split('\n').includes(`v${next}`)) die(`Tag v${next} already exists.`)

console.log(`\n  ${cur}  →  ${next}${dryRun ? '   (dry run — nothing written)' : ''}\n`)

// --- write every manifest in lockstep ------------------------------------
pkg.version = next
write('package.json', JSON.stringify(pkg, null, 2) + '\n')

const tauri = JSON.parse(read('src-tauri/tauri.conf.json'))
tauri.version = next
write('src-tauri/tauri.conf.json', JSON.stringify(tauri, null, 2) + '\n')

write('src-tauri/Cargo.toml',
  read('src-tauri/Cargo.toml').replace(/(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/, `$1${next}$2`))

write('src-tauri/Cargo.lock',
  read('src-tauri/Cargo.lock').replace(/(name = "agent-forge"\nversion = ")[^"]+(")/, `$1${next}$2`))

const lock = JSON.parse(read('package-lock.json'))
lock.version = next
if (lock.packages?.['']) lock.packages[''].version = next
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n')

const files = [
  'package.json', 'package-lock.json',
  'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
]

if (dryRun) {
  console.log('  Would update:\n    ' + files.join('\n    '))
  console.log(`\n  Then: commit "release: v${next}", tag v${next}, push --follow-tags.\n`)
  process.exit(0)
}

// --- commit, tag, push ----------------------------------------------------
sh(`git add ${files.join(' ')}`)
sh(`git commit -m "release: v${next}"`)
sh(`git tag -a v${next} -m "v${next}"`) // annotated so --follow-tags pushes it
console.log(sh('git push --follow-tags'))
console.log(`\n  ✅ Released v${next}. CI is building & publishing now.`)
console.log(`     Track it:  gh run watch $(gh run list --workflow=release.yml -L1 --json databaseId --jq '.[0].databaseId') -R git-layton/agent-forge\n`)
