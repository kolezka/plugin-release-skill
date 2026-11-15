---
name: plugin-release
description: Use when a Claude Code plugin, plugin marketplace or DeepSeek Harness (DSH) bundle repo needs versioned releases, such as adding a release workflow that bumps patch, minor or major, keeping plugin.json, marketplace.json and package.json versions in sync, generating a CHANGELOG, creating GitHub releases, or cutting a release in a repo that already has this setup.
---

# Plugin release

Sets up, or runs, a GitHub Actions release for a plugin repo. One manual workflow takes
`patch`, `minor` or `major`, bumps every version file, runs the build, prepends a
`CHANGELOG.md` section built from Conventional Commits since the last tag, then commits,
tags, pushes and creates the GitHub release.

Templates sit next to this file in `templates/`:

| File | Goes to | Edit |
| --- | --- | --- |
| `release.ts` | `scripts/release.ts` | none, it reads `release.config.json` |
| `release.yml` | `.github/workflows/release.yml` | replace every `__PLACEHOLDER__` |
| `release.config.json` | repo root | list the real version files |
| `CHANGELOG.md` | repo root, only if missing | the current version and date |

Claude Code only offers a plugin update when the version changes, and a marketplace entry
whose version disagrees with its `plugin.json` confuses installs. That is why every version
file moves together.

## Set up releases in a repo

1. **Check the repo state.** `git status --short` is clean, you are on a branch for this
   change (not the default branch), and `gh repo view` works.
2. **Find every version.** Search tracked files with
   `git ls-files | rg '(plugin|marketplace|package)\.json$'` and read each one:
   - `.claude-plugin/plugin.json` and `plugins/*/.claude-plugin/plugin.json`: `version`
   - `.claude-plugin/marketplace.json`: `plugins[i].version` for each plugin from this repo,
     and `metadata.version` if present
   - every `package.json` the repo publishes or versions, including a DSH bundle's
     (`"dsh": { "bundle": ... }`)
   They must all hold the same plain `MAJOR.MINOR.PATCH`. If they disagree, show the user
   the values and ask which is right. Do not pick one yourself. A repo with several plugins
   on separate versions needs one config per plugin; ask before setting that up.
3. **Write `release.config.json`.** `versionSource` is the plugin manifest. `key` is a JSON
   path, for example `["plugins", 0, "version"]`. `build` is the command whose output the
   release must carry (a bundled MCP server, for example) or is left out. Use `tagPrefix`
   `"v"` unless the repo already tags differently (`git tag --list | tail`).
4. **Copy `release.ts`** to `scripts/release.ts` unchanged.
5. **Fill `release.yml`.** `__CHECK__` is what CI already runs (read
   `.github/workflows/*.yml` and `package.json` scripts). If the build output is committed,
   add `git diff --exit-code -- <output>` after the build so a stale artifact fails.
   Add `actions/setup-node` or other runtimes the checks need. Re-pin each action:
   `gh api repos/actions/checkout/git/ref/tags/v4 -q .object.sha`.
6. **Changelog and baseline tag.** Create `CHANGELOG.md` from the template if missing. If
   the current version has no tag, the first release would list all history again. Offer to
   tag the commit that shipped it (`git tag -a v<version> <sha>`, then
   `gh release create`). Tags and releases are public, so ask first.
7. **Prove it before merging.**
   - Clone the branch to a temp dir, `bun install` there (a symlinked `node_modules` shows up
     as untracked and the script refuses a dirty tree), tag the baseline locally, run
     `bun scripts/release.ts minor --notes-out notes.md --date 2026-01-01`, then read every
     version file, the rebuilt output and `CHANGELOG.md`.
   - Open a PR. The workflow runs in dry-run mode on PRs touching the release files. Read the
     "Show the release" step log, not just the green check.
   - After merge, run once with `dry_run` on the default branch:
     `gh workflow run release.yml -f bump=patch -f dry_run=true`.

## Cut a release

1. Confirm with the user which bump. Breaking changes mean `major` (`minor` while on `0.x`
   is the user's call).
2. `gh workflow run release.yml -f bump=<bump>`, then
   `gh run watch <id> --exit-status`.
3. Verify the outcome, not the run status: `git ls-remote origin refs/tags/v<new>`,
   `gh release view v<new>`, and the version in `plugin.json` on the default branch.

## Known traps

- **Branch protection.** The job pushes as `github-actions[bot]`. A protected default branch
  rejects it. Either add the bot to the ruleset bypass list or switch the push to a
  deploy key or app token; ask the user which.
- **Pushes by `GITHUB_TOKEN` do not trigger other workflows**, so CI does not run on the
  release commit. The workflow runs the checks itself before publishing.
- **The push is atomic.** If the branch moved while the job ran, the push fails and nothing
  is published. Re-run it.
- **Untracked files stop the release.** `release.ts` refuses a dirty tree, untracked files
  included. Commit the lockfile and install with `--frozen-lockfile` in `__CHECK__`, so the
  install creates nothing new.
- **Merge commits** and earlier `chore(release)` commits are left out of the changelog.
- **Prerelease versions** (`1.0.0-rc.1`) are not supported by `release.ts`. It refuses them.

## DeepSeek Harness

This skill also loads in DSH through the plugin's bundle. The release workflow itself only
needs `gh`, `git` and `bun`, the same in either host.
