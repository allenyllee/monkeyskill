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
- Stop paste-specific handlers without reading clipboard contents.

## Safety constraints

- Never make network requests.
- Never read cookies, storage, form values, or clipboard contents.
- Never modify links, form submission, navigation, or left-click handlers.
- Do not run on Chrome internal pages or the Chrome Web Store.

## Success criteria

- Selected text remains selected.
- Copy and cut keyboard shortcuts reach the browser default behavior.
- A real user right-click can open the native context menu.
- Dynamically added protected content is repaired.
- Empty blocking overlays and `pointer-events: none` media are repaired.
- Ordinary links, buttons, inputs, and editable fields still work.
