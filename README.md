# plugin-release-skill

A skill for Claude Code and DeepSeek Harness (DSH) that gives a plugin repo versioned
releases. Ask the agent to "set up releases for this plugin" and it:

- finds every version field (`plugin.json`, `marketplace.json` entries, `package.json`
  files including a DSH bundle) and checks they agree,
- adds `scripts/release.ts`, `release.config.json` and `.github/workflows/release.yml`,
- adds `CHANGELOG.md` and offers a baseline tag for the current version,
- proves the setup on a throwaway clone and in a pull-request dry run.

The workflow it installs is started from the Actions tab with `patch`, `minor` or `major`.
It bumps all version files together, runs the build, prepends a changelog section from
Conventional Commits since the last tag, pushes commit and tag atomically and creates the
GitHub release. `dry_run` shows the result without publishing.

The skill can also cut a release in a repo that already has the setup.

## Install in Claude Code

```sh
claude plugin marketplace add kolezka/plugin-release-skill
claude plugin install plugin-release@plugin-release-skill
```

## Install in DeepSeek Harness

```sh
git clone https://github.com/kolezka/plugin-release-skill
dsh plugin --profile web add file:$PWD/plugin-release-skill/plugins/plugin-release
```

The bundle loads the skill through
[`claude-plugin-dsh`](https://github.com/kolezka/claude-plugins-dsh).

## What the installed workflow needs

`bun` on the runner (the template sets it up) and permission for `github-actions[bot]` to
push to the default branch. A protected branch needs the bot in its ruleset bypass list.

## Development

```sh
bun install
bun run check
bun test     # release.ts against scratch git repos
```

This repo releases itself with the same template: see `.github/workflows/release.yml`.

## License

MIT
