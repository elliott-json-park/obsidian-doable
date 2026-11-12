# Changelog

## 1.1.1

- The agenda and query blocks follow Settings → Appearance → Font size. At the default size nothing changes; a smaller or larger font now makes Doable's text smaller or larger with it (#1).

## 1.1.0

- A one-time request to star the repository. After an update, the first time you open the Doable view yourself, a small window asks for a GitHub star. It shows once, only to people who updated, never at start-up. See "One-time message" in the README.

## 1.0.2

- The settings tab no longer calls a method that apps before 1.13 do not have.

## 1.0.1

- Quick add now works on iPhones and iPads with iOS before 16.4. It used a pattern those versions cannot read.
- Settings appear in Obsidian's settings search (1.13 and later).
- Tidier code and styles, as asked by the community review. Nothing else changes.

## 1.0.0

First release.

- **The agenda.** Every task in the vault as Overdue, Today, the next days, Later, No date and Done today. Tick to complete, click the day to move it, drag onto a day, right-click for priority.
- **Add in plain words.** "Call Ana tomorrow #home every week !high" becomes a task with a due date, a repeat and a priority. English, Korean and Chinese.
- **Chips in notes.** Dates, repeats and priorities read as small chips in Live Preview and Reading view. Click one to change it. Type `@` on a task line for dates.
- **Tasks format.** Reads and writes the Tasks plugin's emoji format, with the same recurrence results, so nothing has to change.
- **Query blocks.** Draws ` ```tasks ` blocks when Tasks is not enabled, and ` ```doable ` blocks always, with the common filters, grouping, sorting and limits.
- **Undo** for every change, and edits that never overwrite text they did not expect.
