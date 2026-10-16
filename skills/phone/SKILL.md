---
name: phone
description: Open the app the user is building in an interactive phone frame (iPhones, iPads, Android phones, a foldable, an Android tablet, or a custom size) in the built-in Browser pane. Use when the user asks for the phone, a phone or mobile preview, or to see their app on a phone.
---

# Open the phone preview

The phone frame is a page served by this plugin's helper. The helper also proxies the app onto its own origin, so the Browser pane's phone emulation (touch, no hover, mobile user agent) reaches the app. Claude opens the pane itself: the plugin can't, because in auto mode its own call to the Browser pane gets no verdict.

1. **Reuse or start the helper.** A helper already running answers `GET http://127.0.0.1:<port>/__phone/health` with `"app":"phone-preview"` on a port from 7357 to 7377; reuse the first one that does. Otherwise run `node <plugin root>/helper/server.mjs` in the background, where the plugin root is two folders above this skill's base directory. It prints `READY <port>` once it listens.
2. **Pick the app URL.** Use the full URL the user gave. Otherwise ask the helper: `GET http://127.0.0.1:<port>/__phone/detect?dir=<project folder, encoded>` (add `&port=<n>` when the user gave only a port). It reads the project's package.json and framework config for the port and base path, checks the usual dev ports, and answers `{ "url", "why", "servers" }`; `url` already includes the base path (for example `http://localhost:5173/ledger/`). When `url` is null, no dev server is running: say so and offer to start it (`npm run dev` in the project) rather than guessing.
3. **Open it.** Call the Browser pane's `preview_start` with
   `http://127.0.0.1:<port>/__phone/?url=<app url, encoded>&device=<device>&mode=<browser|app>`
   where device is an iPhone (`iphone18pro`, `iphone18promax`, `iphone17`, `iphoneair`, `iphone17pro`, `iphone17promax`, `iphone16`, `iphone16plus`, `iphone16pro`, `iphone16promax`, `iphone15`, `iphonese`), an iPad (`ipadmini`, `ipad`, `ipadair`, `ipadair13`, `ipadpro11`, `ipadpro13`), an Android device (`pixel8`, `galaxys24`, `galaxyzfold` with `&fold=1` for open, `pixeltablet`), or `custom&w=<width>&h=<height>&os=<ios|android>`
   (`browser` is Safari or Chrome, `app` is the Home Screen app; default `iphone15` and `browser`), then `resize_window` with width 480 and height 960 so the pane emulates a touch phone.
4. **Tell the user** which device and mode it shows, and that the bottom bar switches device, mode, keyboard and network speed, and the top bar rotation and zoom. With "Reload on edit" on, the frame reloads after Claude edits files, through the plugin's hook.

If the pane is hidden, ask the user to press Ctrl+Shift+B (Cmd+Shift+B on Mac). `/phone [url|port] [device]` also starts the helper, finds the dev server when given no address, and prints the same link.
