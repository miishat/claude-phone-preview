# phone-preview

A Claude Code plugin that shows the app you are building inside an interactive phone frame in the desktop app's built-in Browser pane. It comes with iPhone 15, iPhone SE, Pixel 8 and Galaxy S24 bodies, Safari/Chrome and Home Screen modes, rotation and zoom, and it reloads after Claude edits files.

Ask Claude for "the phone" in any session, or run `/phone [url|port] [device]`.

## How it works

- `helper/server.mjs` serves the frame at `/__phone/` and proxies everything else to your dev server, so the app runs on the frame's origin and gets the pane's phone emulation. It rewrites `env(safe-area-inset-*)` to the frame's insets and injects `helper/shim.js`, which reports the chosen device to the app.
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
