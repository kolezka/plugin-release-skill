import { afterEach, describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bumpVersion, prependChangelog, prepareRelease, renderSection } from '../plugins/plugin-release/skills/plugin-release/templates/release.ts'

const startDir = process.cwd()

describe('bumpVersion', () => {
  test('bumps each part and resets the lower ones', () => {
    expect(bumpVersion('1.4.7', 'patch')).toBe('1.4.8')
    expect(bumpVersion('1.4.7', 'minor')).toBe('1.5.0')
    expect(bumpVersion('1.4.7', 'major')).toBe('2.0.0')
    expect(bumpVersion('0.1.0', 'major')).toBe('1.0.0')
  })

  test('rejects unknown bumps and non-plain versions', () => {
    expect(() => bumpVersion('1.0.0', 'huge' as never)).toThrow('Unknown bump')
    expect(() => bumpVersion('1.0.0-rc.1', 'patch')).toThrow('not plain')
  })
})

describe('changelog', () => {
  const commits = [
    { sha: 'aaaaaaa1', subject: 'feat(tools): add umami_list_events', body: '' },
    { sha: 'bbbbbbb2', subject: 'fix: redact newPassword', body: '' },
    { sha: 'ccccccc3', subject: 'refactor!: rename tools', body: '' },
    { sha: 'ddddddd4', subject: 'docs: explain ranges', body: 'BREAKING CHANGE: no, this line is in the body' },
    { sha: 'eeeeeee5', subject: 'chore(release): v0.1.0', body: '' },
    { sha: 'fffffff6', subject: 'Merge pull request #3 from x/y', body: '' },
    // The synthetic merge commit GitHub checks out for a pull_request run.
    { sha: '99999997', subject: 'Merge 6488b44 into ce00d0d', body: '' },
  ]

  test('groups conventional commits and skips release and merge commits', () => {
    const s = renderSection('0.2.0', '2026-11-15', commits)
    expect(s).toStartWith('## [0.2.0] - 2026-11-15\n')
    expect(s).toContain('### Breaking changes\n\n- refactor: rename tools (ccccccc)\n- docs: explain ranges (ddddddd)')
    expect(s).toContain('### Features\n\n- **tools:** add umami_list_events (aaaaaaa)')
    expect(s).toContain('### Fixes\n\n- redact newPassword (bbbbbbb)')
    expect(s).not.toContain('v0.1.0')
    expect(s).not.toContain('Merge ')
  })

  test('says so when nothing user-facing changed', () => {
    expect(renderSection('0.1.1', '2026-11-15', [commits[4]!])).toContain('No user-facing changes.')
  })

  test('puts the new section above older ones and creates the file once', () => {
    const first = prependChangelog(null, '## [0.1.0] - a\n')
    expect(first).toStartWith('# Changelog\n')
    const second = prependChangelog(first, '## [0.2.0] - b\n')
    expect(second.indexOf('## [0.2.0]')).toBeLessThan(second.indexOf('## [0.1.0]'))
    expect(second.match(/# Changelog/g)).toHaveLength(1)
  })
})

describe('prepareRelease on a scratch repo', () => {
  let dir = ''
  afterEach(() => {
    process.chdir(startDir)
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  async function scratch(versions: { pkg?: string; manifest?: string } = {}) {
    dir = mkdtempSync(join(tmpdir(), 'release-test-'))
    await Bun.write(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: versions.pkg ?? '0.3.1' }, null, 2) + '\n')
    await Bun.write(
      join(dir, 'market.json'),
      JSON.stringify({ plugins: [{ name: 'x', version: versions.manifest ?? '0.3.1' }] }, null, 2) + '\n',
    )
    await Bun.write(
      join(dir, 'release.config.json'),
      JSON.stringify({
        versionSource: 'package.json',
        versionFiles: [
          { path: 'package.json', key: ['version'] },
          { path: 'market.json', key: ['plugins', 0, 'version'] },
        ],
        build: ['sh', '-c', 'cat package.json > built.txt'],
        changelog: 'CHANGELOG.md',
        tagPrefix: 'v',
      }),
    )
    const git = (args: string[]) => $`git -C ${dir} -c user.name=t -c user.email=t@t ${args}`.quiet()
    await git(['init', '-q', '-b', 'main'])
    await git(['add', '.'])
    await git(['commit', '-q', '-m', 'feat: first'])
    await git(['tag', 'v0.3.1'])
    await Bun.write(join(dir, 'a.txt'), 'a')
    await git(['add', '.'])
    await git(['commit', '-q', '-m', 'fix(api): handle 404'])
    return git
  }

  test('bumps every file, runs the build, writes changelog and notes', async () => {
    await scratch()
    const notesOut = join(dir, '..', `${dir.split('/').pop()}-notes.md`)
    const r = await prepareRelease('minor', { cwd: dir, date: '2026-11-15', notesOut })
    expect(r.tag).toBe('v0.4.0')
    expect((await Bun.file(join(dir, 'package.json')).json()).version).toBe('0.4.0')
    expect((await Bun.file(join(dir, 'market.json')).json()).plugins[0].version).toBe('0.4.0')
    // The build ran after the bump, so its output carries the new version.
    expect(await Bun.file(join(dir, 'built.txt')).text()).toContain('"version": "0.4.0"')
    const changelog = await Bun.file(join(dir, 'CHANGELOG.md')).text()
    expect(changelog).toContain('## [0.4.0] - 2026-11-15')
    // Only commits after the last tag.
    expect(changelog).toContain('**api:** handle 404')
    expect(changelog).not.toContain('first')
    expect(await Bun.file(notesOut).text()).toStartWith('### Fixes')
    expect(r.files.sort()).toEqual(['CHANGELOG.md', 'built.txt', 'market.json', 'package.json'])
    rmSync(notesOut)
  })

  test('refuses a dirty tree, an existing tag and drifted version files', async () => {
    await scratch()
    await Bun.write(join(dir, 'a.txt'), 'changed')
    await expect(prepareRelease('patch', { cwd: dir, date: 'd' })).rejects.toThrow('not clean')
    process.chdir(startDir)
    rmSync(dir, { recursive: true, force: true })

    const git = await scratch()
    await git(['tag', 'v0.3.2'])
    await expect(prepareRelease('patch', { cwd: dir, date: 'd' })).rejects.toThrow('Tag v0.3.2 already exists')
    process.chdir(startDir)
    rmSync(dir, { recursive: true, force: true })

    await scratch({ manifest: '0.3.0' })
    await expect(prepareRelease('patch', { cwd: dir, date: 'd' })).rejects.toThrow('market.json')
    // Nothing was written when the check failed.
    expect((await Bun.file(join(dir, 'package.json')).json()).version).toBe('0.3.1')
  })
})
