# Restore right click & copy

## Goal

Restore the browser context menu, text selection, copying, cutting, pasting, and dragging on pages that intentionally block those native interactions.

## Standard mode

- Stop page handlers from cancelling `contextmenu`, `copy`, `cut`, `selectstart`, and `dragstart`, including primary-button `mousedown` handlers that cancel native text selection and `keydown` handlers that cancel Ctrl/Cmd+C or Ctrl/Cmd+X before the copy/cut event occurs. This includes DOM property handlers such as `element.onkeydown = fn` that cancel by returning `false`, not only listeners that call `preventDefault()`.
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
- Treat restoration as part of the selection gesture only. A later deliberate primary click on another ordinary page area must discard the saved range and collapse the selection normally, even if Chrome reports a late `selectionchange` containing the old non-collapsed range during that dismissal gesture.
- When the user deliberately clicks an input, textarea, link, button, or editable control after selecting page text, discard the saved page range instead of restoring it; the clicked control must retain focus and remain usable.
- Restore pointer events on blocked media and bypass empty overlays covering media or editable controls.
- Restore visible selection colors when a page makes `::selection` transparent, including ID-specific author rules that also use `!important`.
- Stop paste-specific handlers without reading clipboard contents, including rollback triggered by the resulting `beforeinput` or `input` event.

## Safety constraints

- Never make network requests.
- Never read cookies, storage, form values, or clipboard contents.
- Never modify links, form submission, navigation, or left-click handlers.
- Do not run on Chrome internal pages or the Chrome Web Store.

## Success criteria

- [criterion:context-menu] A real user right-click can open the native context menu on ordinary elements, inputs, images, overlays, and CSS-background elements.
- [criterion:text-selection] Selected text remains selected despite `user-select: none`, `unselectable=on`, primary `mousedown` cancellation, or `selectstart` cancellation. Standard-mode tests must independently model both the `mousedown` and `selectstart` blocker families.
- [criterion:selection-dismissal] After page text has been selected, a later real primary-button click on another ordinary page area collapses the selection instead of restoring a stale saved range, including when `selectionchange` timing briefly exposes the old range during the new click.
- [criterion:keyboard-copy] Ctrl/Cmd+C and Ctrl/Cmd+X keydown handlers cannot cancel the shortcut before the browser's copy or cut default behavior occurs. Tests must independently cover listener cancellation through `preventDefault()` and DOM `onkeydown` property cancellation through `return false`.
- [criterion:paste] Paste reaches editable controls and the inserted value remains after the resulting `beforeinput` and `input` events, without page handlers blocking or rolling it back.
- [criterion:pointer-overlays] Empty blocking overlays and `pointer-events: none` media are repaired.
- [criterion:selection-visibility] Page styles cannot leave only a changed text color while the selection background remains transparent, even through a higher-specificity ID-scoped `::selection { background: transparent !important }` rule. Tests must use `id-ancestor` specificity and independently assert a non-transparent selection background.
- [criterion:preserve-controls] After page text has been selected, a real primary-button click into an ordinary link, button, input, textarea, or editable field discards the stale page selection; the clicked control keeps focus and its input, editing, navigation, and left-click behavior still work.
- [criterion:no-network] The implementation makes no network requests.
