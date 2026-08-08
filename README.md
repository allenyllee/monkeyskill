# MonkeySkill

MonkeySkill is an experimental Manifest V3 Chrome extension that installs small browser abilities per site. The first packaged skill independently reimplements the public behavior of **Absolute Enable Right Click & Copy**: restoring the native context menu, selection, copying, cutting, and dragging.

No source code or visual assets from the referenced extension are included.

## Current feature set

- Install the right-click skill for the current site or all HTTP(S) sites.
- Standard mode for normal copy/right-click blockers.
- Absolute mode for pages that continually re-register blockers.
- Per-site overrides over a global default.
- Optional host permissions requested only when the user enables a scope.
- Local-only settings; no analytics or network requests.
- A human-readable `SKILL.md`, capability manifest, and acceptance-test specification.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.
5. Open a regular website, click MonkeySkill, choose a mode, and apply it.

Developer mode is needed here only because this repository is loaded unpacked. A Chrome Web Store build would not require it.

## Test page

Run:

```powershell
npm run serve:demo
```

Then open `http://127.0.0.1:4173/blocked.html`. Try selection, copying, and right-click before and after enabling Standard and Absolute modes.

## Development

```powershell
npm test
npm run check
```

## Architecture

- `src/background.js` keeps registered content scripts synchronized with user settings.
- `src/lib/settings.js` contains pure settings and registration logic.
- `src/skills/restore-right-click/` is the first Monkey Skill package.
- `src/popup/` installs/configures the skill for the active site.
- `src/options/` manages global settings and site overrides.

The first skill uses packaged scripts through `chrome.scripting`, so it works without Chrome's **Allow User Scripts** toggle. A later LLM-generated-code milestone should use `chrome.userScripts` and require that explicit user opt-in.

## Security boundary

This skill has no network, cookie, history, or download capability. Absolute mode intentionally changes page-level event behavior and can break legitimate custom context menus; disable it for affected sites.

