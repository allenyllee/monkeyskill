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
- Sixteen fixed executable behavior tests packaged with the MSkill and run in isolated sandbox frames before both review and installation.
- Durable offscreen generation jobs, so multi-minute LLM requests survive MV3 service-worker suspension and Store refreshes preserve running, failed, and ready outcomes.
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
5. MonkeySkill runs the packaged behavior suite in isolated frames; a failing build is rejected before review.
6. Review the summary, validation results, hash, and complete generated JS/CSS.
7. Select **Approve and install** or discard the draft. The same build is tested again immediately before installation.

The API key is kept in `chrome.storage.local`, restricted to trusted extension contexts, and is never returned to the options UI after saving. This protects it from page scripts, but browser-local storage is not a hardware-backed secret store.

## Test page

Run:

```powershell
npm run serve:demo
```

Then open `http://127.0.0.1:4173/store.html` for the local MSkill Store, or `http://127.0.0.1:4173/blocked.html` for the 16-method behavior matrix.

The Store reads the Extension's packaged catalog, asks before sending an MSkill to the configured LLM, waits for static and packaged behavior validation, shows the model/hash/validation summary, asks for final approval, and only then installs the generated build. Its page bridge is injected only on the two local Store URLs declared in `manifest.json`; background handlers independently verify the sender URL.

## Local agent API

Run a local OpenAI-compatible endpoint that exercises the complete Extension request, generation, validation, review, and approval path:

```powershell
npm run serve:agent
```

The server prints a random local token. In MonkeySkill's LLM settings use:

- Endpoint: `http://127.0.0.1:8787/v1/chat/completions`
- Model: `local-agent`
- API key: the printed local token

The default `fixture` agent runs offline and deterministically turns the bundled Restore right click MSkill into a response with the same shape as Chat Completions. This verifies the whole integration without spending API credits. Each call creates an inspectable conversation; use the printed `/sessions` URL with the same bearer token.

To hand the conversation to a real upstream OpenAI-compatible agent instead, keep the Extension pointed at localhost and start the bridge in proxy mode:

```powershell
$env:MONKEYSKILL_AGENT_MODE = "proxy"
$env:MONKEYSKILL_UPSTREAM_API_KEY = "your-upstream-key"
$env:MONKEYSKILL_UPSTREAM_MODEL = "your-model"
npm run serve:agent
```

Optional variables are `MONKEYSKILL_UPSTREAM_ENDPOINT`, `MONKEYSKILL_LOCAL_TOKEN`, `MONKEYSKILL_AGENT_PORT`, and the subagent queue timeout `MONKEYSKILL_AGENT_TIMEOUT_MS`. The upstream key stays in the local server process and is not stored by the Extension.

For an interactive Codex-only experiment, `MONKEYSKILL_AGENT_MODE=subagent` exposes a protected one-job queue at `/agent/jobs/next`. A live Codex task must explicitly collect each queued request and submit its generated JSON to `/agent/jobs/{id}/complete`; this mode is intentionally not presented as a standalone background service.

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
generated/restore-right-click/1.2.0/   Build descriptor for the current tested Skill version
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
- `generated/restore-right-click/1.2.0/` contains the current build descriptor; unchanged runtime JS/CSS may be reused from prior generated versions while the fixed tests remain under the versioned MSkill source.
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

The Restore right click skill has no network, cookie, history, or download capability. Generated code is rejected when basic static checks detect forbidden APIs or remote content, Chrome parses it through a temporary `userScripts` registration, and the MSkill's fixed behavior suite runs in sandboxed frames before review and again before installation. These checks reduce risk but do not prove arbitrary JavaScript safe, so installation remains a separate explicit user action. Absolute mode intentionally changes page-level event behavior and can break legitimate custom context menus; disable it for affected sites.
