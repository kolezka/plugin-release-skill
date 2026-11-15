// Prepares a release in the working tree: bumps every version file, rebuilds, prepends a
// CHANGELOG section and writes the release notes. Committing, tagging and publishing are
// left to the caller (see .github/workflows/release.yml).
//
// Usage: bun scripts/release.ts <patch|minor|major> [--notes-out <file>] [--date YYYY-MM-DD]

import { appendFileSync } from 'node:fs'
import { $ } from 'bun'

export type Bump = 'patch' | 'minor' | 'major'
type KeyPath = (string | number)[]

export interface ReleaseConfig {
  versionSource: string
  versionFiles: { path: string; key: KeyPath }[]
  build?: string[]
  changelog: string
  tagPrefix: string
}

export interface Commit {
  sha: string
  subject: string
  body: string
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

export function bumpVersion(current: string, bump: Bump): string {
  const m = SEMVER.exec(current)
  if (!m) throw new Error(`Current version "${current}" is not plain MAJOR.MINOR.PATCH`)
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump "${bump}", expected patch, minor or major`)
}

function getAt(obj: unknown, key: KeyPath): unknown {
  return key.reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string | number, unknown>)[k]), obj)
}

function setAt(obj: unknown, key: KeyPath, value: string): void {
  const parent = getAt(obj, key.slice(0, -1))
  const last = key[key.length - 1]!
  if (parent == null || typeof parent !== 'object' || !(last in parent)) {
    throw new Error(`Key ${JSON.stringify(key)} does not exist`)
  }
  ;(parent as Record<string | number, unknown>)[last] = value
}

const SECTIONS: [string, (c: { type: string; breaking: boolean }) => boolean][] = [
  ['Breaking changes', (c) => c.breaking],
  ['Features', (c) => !c.breaking && c.type === 'feat'],
  ['Fixes', (c) => !c.breaking && c.type === 'fix'],
  ['Other changes', (c) => !c.breaking && c.type !== 'feat' && c.type !== 'fix'],
]

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/

export function renderSection(version: string, date: string, commits: Commit[]): string {
  const parsed = commits
    .filter((c) => !/^chore\(release\)/.test(c.subject) && !/^Merge /.test(c.subject))
    .map((c) => {
      const m = CONVENTIONAL.exec(c.subject)
      const type = m?.[1] ?? 'other'
      const scope = m?.[2]
      const text = m?.[4] ?? c.subject
      const breaking = Boolean(m?.[3]) || /^BREAKING[ -]CHANGE:/m.test(c.body)
      // Feature and fix sections already name the type; elsewhere keep it (docs, ci, refactor).
      const kind = m && type !== 'feat' && type !== 'fix' ? `${type}: ` : ''
      return { type, breaking, line: `- ${kind}${scope ? `**${scope}:** ` : ''}${text} (${c.sha.slice(0, 7)})` }
    })
  const lines = [`## [${version}] - ${date}`, '']
  for (const [title, match] of SECTIONS) {
    const items = parsed.filter(match)
    if (items.length) lines.push(`### ${title}`, '', ...items.map((i) => i.line), '')
  }
  if (!parsed.length) lines.push('No user-facing changes.', '')
  return lines.join('\n')
}

export function prependChangelog(existing: string | null, section: string): string {
  const header = '# Changelog\n\nAll notable changes to this project are listed here. Versions follow [Semantic Versioning](https://semver.org).\n\n'
  if (!existing) return header + section
  const at = existing.indexOf('\n## ')
  if (at === -1) return existing.trimEnd() + '\n\n' + section
  return existing.slice(0, at + 1) + section + '\n' + existing.slice(at + 1)
}

async function commitsSince(tag: string | null): Promise<Commit[]> {
  const range = tag ? `${tag}..HEAD` : 'HEAD'
  const out = await $`git log --format=%H%x1f%s%x1f%b%x1e ${range}`.text()
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha = '', subject = '', body = ''] = r.split('\x1f')
      return { sha, subject, body }
    })
}

async function lastTag(prefix: string): Promise<string | null> {
  const res = await $`git describe --tags --abbrev=0 --match ${`${prefix}[0-9]*`}`.nothrow().quiet()
  return res.exitCode === 0 ? res.text().trim() : null
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text())
}

export async function prepareRelease(
  bump: Bump,
  opts: { cwd: string; date: string; notesOut?: string; configPath?: string },
): Promise<{ version: string; tag: string; notes: string; files: string[] }> {
  process.chdir(opts.cwd)
  const config = (await readJson(opts.configPath ?? 'release.config.json')) as ReleaseConfig

  const dirty = (await $`git status --porcelain`.text()).trim()
  if (dirty) throw new Error(`Working tree is not clean:\n${dirty}`)

  const source = config.versionFiles.find((f) => f.path === config.versionSource)
  if (!source) throw new Error(`versionSource ${config.versionSource} is not listed in versionFiles`)
  const current = String(getAt(await readJson(source.path), source.key))
  const version = bumpVersion(current, bump)
  const tag = `${config.tagPrefix}${version}`

  if ((await $`git rev-parse -q --verify ${`refs/tags/${tag}`}`.nothrow().quiet()).exitCode === 0) {
    throw new Error(`Tag ${tag} already exists`)
  }

  // Every version file must agree before the bump, otherwise one of them drifted by hand.
  for (const f of config.versionFiles) {
    const found = getAt(await readJson(f.path), f.key)
    if (found !== current) throw new Error(`${f.path} ${JSON.stringify(f.key)} is ${found}, expected ${current}`)
  }
  for (const f of config.versionFiles) {
    const json = await readJson(f.path)
    setAt(json, f.key, version)
    await Bun.write(f.path, JSON.stringify(json, null, 2) + '\n')
  }

  if (config.build?.length) await $`${config.build}`

  const section = renderSection(version, opts.date, await commitsSince(await lastTag(config.tagPrefix)))
  const changelog = Bun.file(config.changelog)
  await Bun.write(config.changelog, prependChangelog((await changelog.exists()) ? await changelog.text() : null, section))

  const notes = section.split('\n').slice(2).join('\n').trim() + '\n'
  if (opts.notesOut) await Bun.write(opts.notesOut, notes)

  const files = (await $`git status --porcelain`.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3))
  return { version, tag, notes, files }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const bump = args[0] as Bump
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i === -1 ? undefined : args[i + 1]
  }
  const result = await prepareRelease(bump, {
    cwd: process.cwd(),
    date: flag('--date') ?? new Date().toISOString().slice(0, 10),
    notesOut: flag('--notes-out'),
  })
  console.log(`Prepared ${result.tag}. Changed files:\n${result.files.map((f) => `  ${f}`).join('\n')}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=${result.tag}\n`)
  }
}
