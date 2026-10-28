# Surrender Dorothy

A projector scene for a haunted house. The Wicked Witch flies across a blue sky and writes "Surrender" in smoke. Then she turns and writes a guest's name on the line below.

A greeter at the entrance enters each guest's name on a phone. The name waits for a delay (60 seconds by default) while the guest walks to the projector room. Then it joins the rotation on the sky. The sky cycles through the last three names. Until the first guest name goes live, it cycles through a fixed idle list.

## What you need

- A laptop with Node.js 18 or later. The app has no npm dependencies.
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

## Configuration

All settings are in `config.json`. Restart the server after you change them.

| Setting | Default | Meaning |
| --- | --- | --- |
| `port` | `8080` | Port for both pages. |
| `prefix` | `"Surrender"` | The first line of text. |
| `delaySeconds` | `60` | Seconds before a new name goes live. Used only on the first run (see below). |
| `rotationSize` | `3` | How many recent guest names the sky cycles through. |
| `timing.writeMs` | `7000` | Time the witch takes to write both lines. |
| `timing.holdMs` | `4000` | Time the finished text stays on the sky. |
| `timing.dissipateMs` | `4000` | Time the smoke takes to drift away. |
| `idleNames` | Dorothy, Peter, … | Names shown before any guest name goes live. |
| `presetNames` | Barney, Betty, … | The greeter's quick-pick list. |

The server saves the queue and the current delay to `state.json`, so a restart keeps them. After the first run, the saved delay overrides `delaySeconds`. To start a fresh night, stop the server and delete `state.json`.

## Custom sky photo

To replace the drawn sky with a photo, save it as `public/sky.jpg` and reload the projector page. The photo pans slowly. To go back to the drawn sky, delete the file.

## Troubleshooting

- If the phone can't load the greeter page, check that the phone and laptop are on the same Wi-Fi. Guest networks often block devices from reaching each other.
- If the phone still can't connect, open System Settings > Network > Firewall and allow incoming connections for Node.
- If the greeter page shows "Reconnecting", the phone has lost the server. The page reconnects by itself when the network returns.
- A small red dot in the bottom-right corner of the projector page means it has lost the server. The scene keeps cycling the last names it received.

## Development

Run the unit tests for the queue logic:

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
| `lib/queue.js` | Queue rules: delay, send now, remove and rotation. |
| `public/index.html`, `public/projector.js` | The projector scene. |
| `public/greeter.html`, `public/greeter.js` | The greeter phone page. |
| `public/fonts/` | Dancing Script font and its license (SIL Open Font License). |
