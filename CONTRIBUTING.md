# Contributing

Bug reports, feature requests and pull requests are all welcome. This file is
the short version of what will make any of them go smoothly.

## Reporting a bug

Open an issue at
[github.com/elliott-json-park/obsidian-doable/issues](https://github.com/elliott-json-park/obsidian-doable/issues).

The useful things are: your Obsidian version, desktop or mobile, the plugin
version, whether the Tasks plugin is enabled, and what you did immediately
before it happened. For a task that lands on the wrong day or repeats wrongly,
paste the task line exactly as it is in the note, and the quick-add text if
you typed it — the line usually shows the cause at once.

## Suggesting a feature

Say what you were trying to do, not only what you would like added.

Two things are deliberately out of scope, so it saves time to say so:

- **A bigger task manager.** Doable is deliberately small: no boards, Gantt
  charts or time tracking. It is an agenda for the tasks already in your
  notes.
- **A format of its own.** Doable reads and writes exactly the Tasks plugin's
  format, so nothing in a vault has to change and Tasks keeps working
  alongside it. A change that writes anything Tasks would not understand will
  not be merged.

## Pull requests

### Setting up

```bash
npm install
npm run dev        # rebuild main.js on change
npm run build      # type-check, then bundle main.js
npm test           # build, the test suite, and the bundle gate
npm run demo-vault # generate a demo vault to try changes in
```

The source is TypeScript in `src/`. The parts most changes touch are
`task.ts` (reading and writing one task line), `nlp.ts` (quick add in
English, Korean and Chinese), `recur.ts` (next dates, computed the way Tasks
computes them), `query.ts` (the everyday Tasks query language), `view.ts`
(the agenda), `editor.ts` (the chips inside notes) and `i18n.ts`.

### Before you open the PR

1. **`npm test` passes.** It also runs `scripts/check-bundle.mjs`, which fails
   on network requests, runtime code loading and other things the community
   review rejects.
2. **The Tasks plugin would agree.** For anything that writes a task line or
   computes a date, a test case with the line Tasks writes for the same input
   is the best evidence.
3. **New text exists in every language.** The interface is in English, Korean
   and Simplified Chinese; add your strings to `src/i18n.ts` for all three.
   Quick-add words in `src/nlp.ts` need all three as well.
4. **`CHANGELOG.md` has a line for it** under the next version.

### Commit messages

A sentence in the imperative that says what the change does for the user:
"Read 'next Friday' as the Friday of next week". Not "fix bug".

## Releases

Maintainer only. Add the version's section to `CHANGELOG.md`, bump
`manifest.json`, `package.json` and `versions.json`, commit, then
`git tag <version> && git push origin <version>`. The workflow in
`.github/workflows/release.yml` runs `npm test`, builds from the tag, uses the
`CHANGELOG.md` section as the release notes, and mints a provenance
attestation so anyone can verify with `gh attestation verify` that the assets
were built by that workflow from this repository.

## License

By contributing you agree that your contribution is licensed under the MIT
licence, the same as the rest of the project. See [LICENSE](LICENSE).
