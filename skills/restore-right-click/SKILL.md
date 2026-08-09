# Restore right click & copy

## Goal

Restore the browser context menu, text selection, copying, cutting, pasting, and dragging on pages that intentionally block those native interactions.

## Standard mode

- Stop page handlers from cancelling `contextmenu`, `copy`, `cut`, `selectstart`, and `dragstart`.
- Remove equivalent inline event-handler attributes.
- Remove inline mouse/pointer handlers only when their source explicitly cancels the event.
- Restore text selection only where the page explicitly disables it.
- Observe dynamically inserted elements without scanning the full page continuously.

## Absolute mode

- Include every standard-mode behavior.
- Ignore future registrations for protected events.
- Prevent page scripts from cancelling protected events.
- Restore selection broadly across the page.
- Block right-button mouse handlers while leaving left-button interactions intact.
- Preserve a live selection when release events try to clear it.
- Restore pointer events on blocked media and bypass empty overlays covering media or editable controls.
- Restore visible selection colors when a page makes `::selection` transparent.
- Stop paste-specific handlers without reading clipboard contents, including rollback triggered by the resulting `beforeinput` or `input` event.

## Safety constraints

- Never make network requests.
- Never read cookies, storage, form values, or clipboard contents.
- Never modify links, form submission, navigation, or left-click handlers.
- Do not run on Chrome internal pages or the Chrome Web Store.

## Success criteria

- [criterion:context-menu] A real user right-click can open the native context menu on ordinary elements, inputs, images, overlays, and CSS-background elements.
- [criterion:text-selection] Selected text remains selected and page `selectstart` blockers no longer disable selection.
- [criterion:keyboard-copy] Copy and cut keyboard shortcuts reach the browser default behavior.
- [criterion:paste] Paste reaches editable controls and the inserted value remains after the resulting `beforeinput` and `input` events, without page handlers blocking or rolling it back.
- [criterion:pointer-overlays] Empty blocking overlays and `pointer-events: none` media are repaired.
- [criterion:selection-visibility] Page styles cannot make the selection highlight transparent.
- [criterion:preserve-controls] Ordinary links, buttons, inputs, editable fields, navigation, and left-click behavior still work.
- [criterion:no-network] The implementation makes no network requests.
