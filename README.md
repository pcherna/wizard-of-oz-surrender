# Surrender Dorothy

Every year for Halloween night, we do a haunted house in our garage for the kids to walk through. This year's theme is the Wizard of Oz. For that, I created this effect:

The Wicked Witch flies across a blue sky and writes "Surrender" in smoke. Then she turns and writes a guest's name or costume name on the line below.

A greeter at the entrance enters each guest's name on a phone. The app has two modes, set by `mode` in `config.json`:

- Rotation mode (`"rotation"`, the default). The name waits for a delay (60 seconds by default) while the guest walks to the projector room. Then it joins the rotation on the sky. The sky cycles through the last three names. Until the first guest name goes live, it cycles through a fixed idle list.
- One-shot mode (`"oneshot"`). The sky shows only clouds until the greeter adds a name. The witch then writes that name once, at once, and the sky goes back to clouds. If a name is on the sky already, the new name waits its turn.

## Use of AI Coding Tools

This package was developed using Claude Code and Claude Opus 5.5.

## What you need

- A laptop with Node.js 20 or later. The app has no npm dependencies.
- A projector connected to the laptop.
- A phone on the same Wi-Fi network as the laptop.

The event needs no internet connection. The font is bundled.

## Setup

1. Edit `config.json`. Put your guest list in `presetNames`. The greeter can tap these names instead of typing them.
2. Start the server:

   ```sh
   npm start
   ```

3. Read the startup output. It prints the projector address and one greeter address for each network the laptop is on.
4. On the laptop, open `http://localhost:8080/` in Chrome on the projector display.
5. Click the page once to go full screen.
6. On the phone, open the greeter address that matches your home Wi-Fi, for example `http://192.168.1.241:8080/greeter`.
7. If macOS asks whether Node may accept incoming connections, click Allow. If you don't, the phone can't connect.

Turn off sleep on the laptop before the event (System Settings > Lock Screen and System Settings > Battery). The projector page asks the browser to keep the screen awake, but don't rely on that alone.

## Using the greeter page

- Type the first letter or two of a name. The quick-pick list narrows to names that start with those letters. Tap a name to add it.
- To add a name that isn't on the list, type it and tap Add.
- The Waiting list shows each name with a countdown. Tap Now to send a name to the sky straight away. Tap × to remove a typo.
- The "On the sky now" list shows the names in the rotation. Tap × to remove one.
- Use −15 and +15 to change the delay during the night. The change applies to names you add afterwards.
- If the projector is too bright, drag the Projector brightness slider at the bottom of the page. The projector follows as you drag, down to 10%. The setting is saved, so it survives a reload or a restart.

In one-shot mode, the page changes:

- The Up next list shows names waiting for their turn, with a countdown. The newest name is on top, and the next name to play is at the bottom. Tap × to remove one. Later names move up.
- Tap × on the name in "On the sky now" to stop it. The witch stops writing, and the smoke fades off in about a second. The next name starts a second after that. A stopped name doesn't go to the Shown list.
- The Shown list has the last five names shown, newest on top. Each name appears once: when a name plays again, it moves to the top. Tap Replay to put a name at the back of the line.
- The Now button and the delay controls are hidden. One-shot mode has no delay.

## Configuration

All settings are in `config.json`. The server reloads the file within a second of each save, and the open pages update by themselves. Only a change to `port` needs a server restart.

If the file has a mistake, for example a missing comma, the server keeps the last good settings. It prints the problem in the terminal where it runs.

On the projector, a new `prefix` or `timing` takes effect with the next name. The name being written finishes first.

You can switch `mode` during the night. When you switch to one-shot mode, names still waiting for their delay play one after another, starting at once.

In one-shot mode, each name gets a slot of `writeMs` + `holdMs` + `dissipateMs` plus one second of clear sky. With the default timing, that's 16 seconds.

| Setting | Default | Meaning |
| --- | --- | --- |
| `port` | `8080` | Port for both pages. Needs a restart. |
| `mode` | `"rotation"` | `"rotation"` or `"oneshot"`. See the start of this file. |
| `prefix` | `"Surrender"` | The first line of text. |
| `delaySeconds` | `60` | Rotation mode only. Seconds before a new name goes live (see below). |
| `rotationSize` | `3` | Rotation mode only. How many recent guest names the sky cycles through. |
| `timing.writeMs` | `7000` | Time the witch takes to write both lines. |
| `timing.holdMs` | `4000` | Time the finished text stays on the sky. |
| `timing.dissipateMs` | `4000` | Time the smoke takes to drift away. |
| `idleNames` | Dorothy, Peter, … | Rotation mode only. Names shown before any guest name goes live. |
| `presetNames` | Barney, Betty, … | The greeter's quick-pick list. |

The server saves the queue, the current delay and the projector brightness to `state.json`, so a restart keeps them. The current delay is whichever changed last: the phone's −15 and +15 buttons, or an edit to `delaySeconds` while the server runs. At startup, the saved delay wins over `delaySeconds`. To start a fresh night, stop the server and delete `state.json`.

## Hot reload

`npm start` runs the server with Node's `--watch` option. When you save a change to `server.js` or a file in `lib/`, the server restarts by itself. The queue survives the restart because it's saved in `state.json`.

The open pages reload by themselves when the server restarts or when you save a file in `public/`. A reloaded projector page picks up a one-shot name partway through. In rotation mode, it starts the next name from the beginning.

The pages don't reload for a `config.json` change. They apply the new settings in place.

## Custom sky photo

To replace the drawn sky with a photo, save it as `public/sky.jpg` and reload the projector page. The photo pans slowly. To go back to the drawn sky, delete the file.

## Troubleshooting

- If the phone can't load the greeter page, check that the phone and laptop are on the same Wi-Fi. Guest networks often block devices from reaching each other.
- If the phone still can't connect, open System Settings > Network > Firewall and allow incoming connections for Node.
- If the greeter page shows "Reconnecting", the phone has lost the server. The page reconnects by itself when the network returns.
- A small red dot in the bottom-right corner of the projector page means it has lost the server. The scene keeps cycling the last names it received.

## Development

Run the unit tests for the queue rules and the config checks:

```sh
npm test
```

To test without touching your real queue, run a second server on another port with its own state file:

```sh
PORT=8099 STATE_FILE=/tmp/test-state.json npm start
```

| File | Purpose |
| --- | --- |
| `server.js` | HTTP server, JSON API and live updates over Server-Sent Events. |
| `lib/queue.js` | Queue rules: delay, send now, remove, rotation and one-shot slots. |
| `lib/config.js` | Reads `config.json` and checks each setting. |
| `public/index.html`, `public/projector.js` | The projector scene. |
| `public/greeter.html`, `public/greeter.js` | The greeter phone page. |
| `public/fonts/` | Dancing Script font and its license (SIL Open Font License). |
