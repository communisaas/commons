# Public-record release scripts

Phase 1 do-3 release pipeline for `commons.email/record/vol-1/issue-1`.

These scripts produce the rendered-form release artifacts that gate the
`record/vol-1-issue-1-v1.0.0` git tag. They run at BUILD TIME via Node
tooling; the SvelteKit production deploy uses the Cloudflare adapter and
does not embed Node tooling at runtime.

## When to run

- At the v1.0.0 release-tag cut.
- For future amendment publications, with `META.version` and `META.date`
  bumped in this directory's scripts and the masthead's `CANONICAL_HASHES`
  pre-set to the new source-document hashes.

## Pre-conditions

- Working tree is clean (`git status --porcelain` is empty). The script
  refuses to run with a dirty tree unless `SKIP_DIRTY_CHECK=1` is set.
- Node ≥ 18, `npm` and `npx` on PATH.
- `playwright` installed (devDependency) and Chromium available — already
  the case when `@playwright/test` is installed, which it is.
- `@axe-core/playwright` installed (devDependency).
- Port 4173 is free (the script boots `vite preview` there).

## Running the cut

```sh
node scripts/release/cut-issue-1.mjs
```

The orchestration:

1. Confirms a clean git tree.
2. Runs `npm run build`.
3. Boots `vite preview` on `:4173`.
4. Runs the a11y audit against the production build. Fails closed on
   serious/critical violations.
5. Exports the PDF (Playwright-driven, headless Chromium, print register).
6. Exports the plain-text combined form (with manifest header and the
   self-hash closure).
7. Writes `static/record/vol-1/issue-1.manifest.json`.
8. Stops the preview server.
9. Prints the `git tag` command. **The script does not execute it.**

After the script succeeds:

```sh
git add static/record/vol-1/
git commit -m "release(record): cut vol-1 issue-1 v1.0.0 artifacts"
git tag -a record/vol-1-issue-1-v1.0.0 -m 'First publication of CONSTITUTION.md@v1.0.0'
git push origin main
git push origin record/vol-1-issue-1-v1.0.0
```

## Environment overrides

| Variable             | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `SKIP_BUILD=1`       | Skip `npm run build` (assumes a fresh build on disk).                    |
| `SKIP_DIRTY_CHECK=1` | Bypass clean-tree pre-flight. Use only for development debugging.        |
| `USE_DEV=1`          | Use the running dev server at `:5173` instead of building+preview.       |
| `PREVIEW_PORT=4173`  | Override preview port (e.g. if 4173 is taken). Must match `vite preview`. |
| `BASE_URL`           | Used by individual export scripts. The orchestrator sets this for them.  |

## Individual scripts

| File                | Output                                              |
| ------------------- | --------------------------------------------------- |
| `export-pdf.mjs`    | `static/record/vol-1/issue-1.pdf`                   |
| `export-text.mjs`   | `static/record/vol-1/issue-1.txt`                   |
| `audit-a11y.mjs`    | `scripts/release/a11y-report.json` (exit code gate) |
| `cut-issue-1.mjs`   | All of the above + `issue-1.manifest.json`          |

Each script can be invoked standalone with `BASE_URL` pointing at any
running server (dev or preview). The orchestrator handles ordering
(PDF must precede TXT so the TXT manifest can carry the PDF's sha256).

## Self-hash closure (TXT)

A file cannot include its own sha256 in its bytes — substituting a hash
into the file changes the bytes, which changes the hash. The TXT export
adopts the standard idiom (used by signed source tarballs, GPG-signed
mail): the value displayed is `sha256(file with that line's hash field
zeroed)`. Verifiers reproduce the claim by zeroing the line and
re-hashing. The post-write integrity hash (the value that `sha256sum`
sees and that the manifest.json records) is distinct by construction
and is checked separately.

## Sandbox / CI fallback

If `npx playwright install chromium` is unavailable in your environment
(some CI sandboxes block downloads), the export scripts will fail with
`browserType.launch: Executable doesn't exist`. The fallback is to run
the cut on a developer workstation with a pre-installed Chromium and
commit the produced artifacts to the release branch.
