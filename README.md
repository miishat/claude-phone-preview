# phone-preview

A Claude Code plugin that shows the app you are building inside an interactive phone frame in the desktop app's built-in Browser pane. It comes with the iPhone 16, 17 and 18 lineups (Air and Plus included), the 15 and SE, six iPads from mini to Pro 13″, Pixel 8, Galaxy S24, a Galaxy Z Fold5 that folds and unfolds, a Pixel Tablet, and any custom size for iOS or Android. It has Safari/Chrome and Home Screen modes, rotation and zoom, and it reloads after Claude edits files.

It behaves like the phone where layouts usually break:

- **Keyboard.** Tapping a text field opens the iOS or Android keyboard, which types into the field. As on a phone it covers the bottom of the page, scrolls the field into view, slides the whole page up when a fixed bar's field can't scroll, and shrinks `visualViewport`. Number pads follow `inputmode`, the return key follows `enterkeyhint`, and Android honours `interactive-widget`.
- **Network.** Online, Fast 4G, Slow 4G, 3G or Offline. The proxy slows the app's pages, data, images and fonts (its own scripts and styles load at full speed) and offline cuts them; the app sees `navigator.onLine`, the `online` and `offline` events and, on Android, `navigator.connection`.
- **Tablets.** Like a real iPad, an iPad reports a Mac user agent to the app; the Pixel Tablet's Chrome asks for desktop sites, as on a real large Android tablet.
- **Browser bars.** Scrolling the page down shrinks Safari's toolbar or hides Chrome's address bar, and scrolling up brings them back. `100vh` is the large viewport, `100svh` the small one and `100dvh` follows the bars, as on a phone.

Ask Claude for "the phone" in any session, or run `/phone [url|port] [device]`. With no address it finds your app's dev server: it reads the project's package.json and framework config (Vite, Next.js, Angular, Astro, Nuxt, SvelteKit, Create React App, Expo) for the port and base path, checks the usual dev ports, and picks the server that serves this project, never another project's.

## How it works

- `helper/server.mjs` serves the frame at `/__phone/` and proxies everything else to your dev server, so the app runs on the frame's origin and gets the pane's phone emulation. It rewrites `env(safe-area-inset-*)` to the frame's insets and injects `helper/shim.js`, which reports the chosen device to the app.
- `helper/detect.mjs` finds the dev server (`/__phone/detect?dir=<project>`, or `node helper/detect.mjs <project>`).
- `hooks/register.tsx` registers `/phone` and, after each edit Claude makes, asks open frames to reload.
- `skills/phone` tells Claude how to open the frame in the Browser pane.

## Install (local folder)

```bash
claude plugin marketplace add C:/Users/misha/phone-preview
```

```bash
claude plugin install phone-preview@phone-preview
```

The plugin runs from this folder. After editing it, run `/reload-plugins` in a session.

## Develop

```bash
claude plugin validate .
```

```bash
claude plugin test .
```
