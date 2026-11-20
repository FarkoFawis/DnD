# Running the app from your own PC

Your PC at home is the server. You switch it on, start the DnD server, and go
to your friend's house. Everyone opens a web address on their phone, on Wi-Fi
or mobile data. It costs nothing.

A free **Cloudflare Tunnel** makes the connection. Your PC calls out to
Cloudflare, and Cloudflare passes your friends through to the app. You change
nothing on your router, and only the app is reachable, not the rest of your PC.

**The catch:** the app is only there while your PC is on and your internet at
home works. If either goes down during the game, the app is gone until it is
back, and nobody is at home to fix it. `docs/hosting.md` (Fly.io) is the way
without that risk.

Everything below is typed in **PowerShell, inside the project folder** (the one
with `package.json` in it).

## Set it up (once)

### 1. Get the newest version

```powershell
git checkout main
git pull
npm install
```

### 2. Install Cloudflare's tunnel program

```powershell
winget install --id Cloudflare.cloudflared
```

Then **close PowerShell and open it again**, and go back into the project folder.

### 3. Start the server

```powershell
npm run host
```

(Double-clicking **`start-server.cmd`** in the project folder does the same.)

The first start builds the app, which takes up to a minute. If Windows asks
whether Node.js may use the network, allow it. Then a box like this appears:

```
==========================================================================
The DnD server is online.

  Address:      https://four-random-words.trycloudflare.com
  At home:      http://192.168.178.31:3001
  Invite code:  raven-kettle-thistle-47
==========================================================================
```

- **Address** is what your friends open.
- **Invite code** is what they need once, when they choose their password.
  Without it, anyone who finds the address could take an account that has not
  logged in yet. It stays the same; you find it in `server\data\host.json`.

**The window is the server.** Leave it open. Closing it (or Ctrl+C) stops the
server. Do not run `npm run dev` at the same time.

### 4. Accounts

Your accounts, characters and campaigns from testing are still there: it is the
same database. To add friends, open a **second** PowerShell window in the
project folder:

```powershell
npm run users -- add Mira Jonas
```

### 5. Try it

On your phone, **switch Wi-Fi off** so it uses mobile data, and open the
address from the box. If you can log in, your friends can too.

### 6. Start it automatically (optional)

```powershell
npm run host -- autostart on
```

From now on the server window opens by itself when you log in to Windows.
`npm run host -- autostart off` undoes it.

## On game night

1. Switch the PC on and log in. The server window opens (or double-click
   `start-server.cmd`).
2. Wait for the box and **send your friends the address**. See below for why it
   is a new one each time.
3. Check it once from your phone on mobile data, then leave.

Good to know:

- **Sleep:** while the server window is open, it keeps the PC awake. The screen
  may still switch off; that is fine. A laptop must stay plugged in with the
  lid open.
- **Windows updates** can restart the PC in the middle of the game. Before you
  leave: Settings > Windows Update > **Pause for 1 week**.
- If the server or the tunnel stops, it starts again by itself. The game state
  is saved on the PC the whole time, so nothing is lost; phones reconnect.

## The address changes on every start

The free address (`….trycloudflare.com`) is a new one each time the server
starts, and also if your internet at home drops for a while. That means:

- You send the address again for every game night.
- Phones remember a login per address, so with a new address everyone types
  their name and password again.
- If the PC restarts while you are away, you cannot see the new address.

For a game night that is fine to start with. If it gets annoying, there are two
ways to a **fixed address**.

### Fixed address A: your own domain (Cloudflare)

Needs a domain (like `example.com`) that is managed by Cloudflare. A domain
costs money every year; buying it directly at Cloudflare
(<https://dash.cloudflare.com> > Domain Registration) is the least setup.

```powershell
cloudflared tunnel login
```

A browser opens: log in to Cloudflare and pick your domain. Then (put your
domain in place of `example.com`):

```powershell
cloudflared tunnel create dnd
cloudflared tunnel route dns dnd dnd.example.com
```

Open `server\data\host.json` in Notepad and change these three lines:

```json
  "tunnel": "named",
  "tunnelName": "dnd",
  "address": "https://dnd.example.com",
```

Close the server window and start the server again. The address is now always
`https://dnd.example.com`.

### Fixed address B: Tailscale Funnel (free, no domain)

Tailscale gives your PC a fixed address like `https://your-pc.something.ts.net`
for free. Your friends need nothing installed. We have not tried this one
ourselves; the steps follow Tailscale's documentation (November 2026).

1. Install Tailscale from <https://tailscale.com/download> and sign in.
2. In PowerShell:

   ```powershell
   tailscale funnel --bg 3001
   ```

   The first time it shows a link to switch Funnel on for your account. Open
   it, approve, and run the command again. It then prints your address, and it
   keeps running after restarts.
3. In `server\data\host.json` set:

   ```json
     "tunnel": "off",
     "address": "https://your-pc.something.ts.net",
   ```

4. Close the server window and start the server again.

`tailscale funnel reset` switches it off again.

## If something goes wrong

| What you see | What to do |
|---|---|
| Friends get an error page at the address | Is the PC on and the server window open? If the PC restarted, the address is a new one: look at the box in the window. |
| "cloudflared is not installed" | Step 2 above, then close the window and start again. |
| "The DnD server is already running" | It is. Look for the other window (or `npm run dev`) and close that one first. |
| "The tunnel does not come up" | The internet at home is down, or Cloudflare cannot be reached. It keeps trying by itself. |
| The PC went to sleep anyway | Switch sleep off for good: `powercfg /change standby-timeout-ac 0` and `powercfg /change hibernate-timeout-ac 0` |
| A friend forgot their password | `npm run users -- reset-password Mira`, they choose a new one with the invite code. |
| Anything else | `server\data\host.log` says what happened. Send it along when you ask for help. |

If the PC is off or your internet at home is down, nothing can be done from
your friend's house. For that evening the paper sheets are the backup.

## Updating the app

Close the server window, then:

```powershell
git pull
npm install
npm run host
```

The server notices the new version and builds it before it starts.

## Settings (`server\data\host.json`)

Written on the first start. Change it in Notepad, then restart the server.

| Setting | Meaning |
|---|---|
| `port` | Port of the app on your PC. Leave it at `3001`. |
| `inviteCode` | The code friends need once. Change it to anything you like. |
| `tunnel` | `"quick"` (free address that changes), `"named"` (fixed address A) or `"off"` (home Wi-Fi only, or fixed address B). |
| `tunnelName`, `address` | Only for a fixed address, see above. |
| `keepAwake` | `true` keeps the PC from sleeping while the server runs. |

## Your data

Everything (accounts, characters, campaigns, pictures) is in the folder
`server\data` on your PC. Copy that folder somewhere now and then, with the
server stopped, and you have a full backup. A single campaign can also be saved
from inside the app: Configure > Backup.
