# Morph Kit agent instructions

Follow [CLAUDE.md](CLAUDE.md) for architecture and [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-process) for the fork PR flow.

## Article 1: Full autonomy, always forward

Follow the [Ashlr Fleet Constitution, Article 1](https://github.com/ashlrai/phantom/blob/master/AGENTS.md#article-1-full-autonomy-always-forward). Keep repository work within signed standing scope and GitHub protections. Arm GitHub auto-merge when available and honor required reviews and checks, Security GATES v3 and the fleet hold list. No force-push to default branches, admin overrides, billing changes, secret disclosure, or making private material public.

Run `bun test` and `bun run typecheck` before opening a PR. Verify the [CI workflow](.github/workflows/ci.yml) before a release. The [npm publish workflow](.github/workflows/publish.yml) runs its PR dry run and publishes from GitHub Releases. Use the existing release process and verify the published package after the workflow completes.
