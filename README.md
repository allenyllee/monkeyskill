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
- A human-readable `SKILL.md`, capability manifest, and acceptance-test specification, stored separately from generated code.
- A single `.mskill.json` package descriptor that joins the separate specification and build at install time.
- A generic package installer used by bundled/preinstalled Skills and future imported `.mskill` packages.
- Uninstall/reinstall behavior that does not silently restore a removed preinstalled Skill on restart.
- BYOK settings for an OpenAI-compatible Chat Completions endpoint, model, and API key.
- A two-step LLM workflow: generate and validate a draft, then explicitly approve installation.
- Runtime-generated builds installed through `chrome.userScripts` while packaged builds continue to use `chrome.scripting`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.
5. Open a regular website, click MonkeySkill, choose a mode, and apply it.

Developer mode is needed here only because this repository is loaded unpacked. A Chrome Web Store build would not require it.

For LLM-generated builds, open the extension's details page and enable **Allow User Scripts**. This is separate from loading the development extension itself.

## Generate from an MSkill

1. Open MonkeySkill's options page.
2. Enter an OpenAI-compatible Chat Completions endpoint, model name, and your own API key.
3. Save the settings and approve access only to that API origin.
4. Select **Generate and validate with my LLM**.
5. Review the summary, validation results, hash, and complete generated JS/CSS.
6. Select **Approve and install** or discard the draft.

The API key is kept in `chrome.storage.local`, restricted to trusted extension contexts, and is never returned to the options UI after saving. This protects it from page scripts, but browser-local storage is not a hardware-backed secret store.

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

## Skill package lifecycle

Development follows the same lifecycle as a future user installation:

```text
skills/restore-right-click/            Human-readable specification
        +
generated/restore-right-click/1.1.1/   Compiled/generated artifacts
        ↓
packages/restore-right-click.mskill.json
        ↓
installSkillPackage()
        ↓
chrome.storage.local: installedSkills
        ↓
chrome.scripting registrations
```

`preinstalled-skills.json` does not bypass installation. It only selects `.mskill.json` package descriptors that should be passed through the normal installer the first time the extension is installed. If a user removes one, its seeded marker prevents it from being silently restored on the next startup. Reinstalling it explicitly uses the same installer again.

## Architecture

- `skills/restore-right-click/` contains only the first Monkey Skill specification, manifest, and tests.
- `skills/mskill-creator/` defines how an agent authors implementation-independent MSkill specifications.
- `skills/mskill-installer/` is the policy prompt used when the user's LLM compiles a specification.
- `generated/restore-right-click/1.1.1/` contains the current generated JavaScript and build manifest; unchanged CSS may be reused from the prior generated version.
- `packages/*.mskill.json` joins one specification and one generated build into a single installable package descriptor.
- `preinstalled-skills.json` is the bundled catalog and preinstall policy.
- `agent-skills.json` catalogs the preinstalled creator and installer policies used by LLM workflows.
- `src/lib/skill-store.js` validates, installs, removes, configures, and builds registrations for Skill packages.
- `src/lib/llm.js` normalizes BYOK settings, builds generation prompts, parses output, and runs capability checks.
- `src/background.js` loads packages through the common installer and synchronizes installed builds with Chrome.
- `src/popup/` installs/configures the skill for the active site.
- `src/options/` manages global settings and site overrides.

The preinstalled build uses packaged scripts through `chrome.scripting`, so it works without Chrome's **Allow User Scripts** toggle. A user-approved LLM build uses `chrome.userScripts` and requires that explicit opt-in.

## Security boundary

The Restore right click skill has no network, cookie, history, or download capability. Generated code is rejected when basic static checks detect forbidden APIs or remote content, and Chrome parses it through a temporary `userScripts` registration before approval. These checks reduce risk but do not prove arbitrary JavaScript safe, so installation remains a separate explicit user action. Absolute mode intentionally changes page-level event behavior and can break legitimate custom context menus; disable it for affected sites.
