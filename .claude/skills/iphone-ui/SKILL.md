---
name: iphone-ui
description: Checklist for building or fixing any screen of Hadi's app so it feels like a native iPhone app (Home Screen PWA, Dynamic Island, Arabic RTL). Use whenever you create or change UI in src/routes or src/components.
---

# iPhone screen checklist

The owner uses the app on a modern iPhone, added to the Home Screen. Check every item before pushing UI.

- **Safe areas:** use the utilities in `src/styles.css` (`safe-top`, `mobile-header`, `tab-bar-bottom`, `pb-tab-bar`, `agent-page`). Never hard-code the notch or home-indicator offsets. Use `dvh`, never `100vh`.
- **Touch:** targets of at least 44pt (Button/Input already get this under `pointer-coarse:`). No hover-only actions; `hover:` only fires on hover devices.
- **Inputs:** text is 16px, so iOS does not zoom. Numbers go through `NumberField` (Arabic digits, decimal keypad). Return moves to the next field and never submits a half-filled form (`src/lib/form-keys.ts`).
- **Sheets and confirms:** use `ResponsiveSheet` (a drawer on phones) and `ConfirmDialog`. Never use `window.confirm` or `window.prompt`.
- **Chat:** always `SessionAgent` inside `agent-page`. The keyboard is handled by `useVisualViewport`; do not add a second chat component.
- **RTL:** use logical classes (`ps-`, `pe-`, `start-`, `end-`). Wrap numbers and prices in `<bdi dir="ltr">`. Mirror direction icons.
- **Theme:** light, dark and automatic come only from `src/lib/theme.ts`. Check both themes.
- **Navigation:** every new route must be listed in `src/lib/nav-registry.ts`, or `tsc` fails.
- **Data freshness:** never use `refetchInterval` or `setInterval` polling. Join the heartbeat with `useBeat`.
- **Copy:** short Arabic in the app's own tone. One main action per screen.
- **Verify:** open the page at 390×844 (the browser preview's mobile preset). Nothing may overflow horizontally, and nothing may sit under the header or the tab bar.
