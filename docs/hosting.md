# Putting the app online

After this, the app has its own address (like `https://your-name.fly.dev`) that
works from anywhere: at a friend's house, on mobile data, without your PC running.

The guide uses **Fly.io**, because it is the cheapest host that gives the app
what it needs: a small server that is always reachable and a **permanent disk**
for the database and the uploaded pictures. You do everything from PowerShell
on Windows. You do not need Docker.

**What it costs.** Fly's price list (checked November 2026) says: the small
server about 4 to 5 US dollars a month if it ran day and night, the 1 GB disk
0.15 dollars a month, and invoices under 5 dollars are waived. The server here
is set to sleep when nobody is connected, so it runs far less than day and
night. Prices change, so look at <https://fly.io/pricing> before you start.
Expect Fly to ask for a credit card.

## Before you start

1. Decide on a **name** for the app. It becomes the address, so
   `hollow-crown-table` gives `https://hollow-crown-table.fly.dev`. Lowercase
   letters, numbers and dashes only, and nobody else on Fly may have it yet.
2. Decide on an **invite code**: a few words only you and your friends know,
   like `owlbear-eats-bard`. Friends need it once, when they choose their
   password. Without it, anyone who finds the address and guesses a name could
   take an account that has not logged in yet.
3. Get the newest version of the app. In PowerShell, inside the project folder:

   ```powershell
   git checkout main
   git pull
   ```

## Set it up (once)

All commands are typed in PowerShell, **inside the project folder** (the one
with `package.json` and `fly.toml` in it).

### 1. Install Fly's command line tool

```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

If Windows answers that `pwsh` is not found, use this instead:

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Close PowerShell and open it again, go back into the project folder, then check
that it worked:

```powershell
fly version
```

### 2. Create your Fly account

```powershell
fly auth signup
```

A browser window opens. Create the account there, then come back to PowerShell.
(On another day or another PC, `fly auth login` logs you in again.)

### 3. Create the app

Put your own name in place of `YOUR-NAME`:

```powershell
fly launch --copy-config --no-deploy --ha=false --name YOUR-NAME --region fra
```

- `fra` is Frankfurt, the closest location.
- If it asks whether you want to **tweak the settings**, answer `N`. If it
  offers extras such as a database, answer `N` too. The app brings its own.
- If the name is taken, run the command again with another name.
- The command writes your name into `fly.toml`. That is meant to happen; git
  will show the file as changed from now on.

### 4. Set the invite code

Put your own code in place of the example:

```powershell
fly secrets set INVITE_CODE=owlbear-eats-bard
```

### 5. Put the app online

```powershell
fly deploy --ha=false
```

The first time takes a few minutes: Fly builds the app on its own computers and
creates the disk. When it ends with a line about your app being deployed, it is
online.

If it complains that the volume `dnd_data` does not exist, create it and deploy
again:

```powershell
fly volumes create dnd_data --region fra --size 1
fly deploy --ha=false
```

### 6. Create the accounts

Open the address once in your browser so the server is awake:

```powershell
fly apps open
```

Then add yourself and your friends (names without spaces):

```powershell
fly ssh console -C "dnd-users add Faris Mira Jonas"
```

Check the list any time with:

```powershell
fly ssh console -C "dnd-users list"
```

If `fly ssh console` says that no machine is running, the server is asleep.
Open the address in the browser and try again.

### 7. Invite your friends

Send each friend three things:

- the address (`https://YOUR-NAME.fly.dev`),
- their username,
- the invite code.

On their first visit they type their username, choose a password and enter the
invite code. After that they only need username and password.

**As an app on the phone:** open the address, then
- iPhone (Safari): Share button, then **Add to Home Screen**.
- Android (Chrome): the three dots, then **Add to Home screen** or **Install app**.

### 8. Bring over what you already have (optional)

Campaigns and characters from your PC do not move by themselves. To take a
campaign along:

1. On the PC version: Play, Host, the gear next to the campaign, **Backup**,
   **Save a backup file**.
2. Make sure every player of that campaign has an account online (step 6).
3. On the online version: Play, Host, **Load a backup file**.

## Later

**A new version of the app.** Whenever new features were merged:

```powershell
git pull
fly deploy --ha=false
```

Nothing on the disk is touched; everyone just reloads the page. If `git pull`
complains about `fly.toml`, run `git stash`, `git pull`, `git stash pop`.

**Accounts.**

```powershell
fly ssh console -C "dnd-users add Edda"
fly ssh console -C "dnd-users reset-password Mira"
fly ssh console -C "dnd-users remove Jonas"
```

After `reset-password` the friend chooses a new password at the next login and
needs the invite code again.

**A new invite code.** `fly secrets set INVITE_CODE=new-code-here` (the server
restarts by itself).

**The private rulebook file.** Content packs (text typed in from your own
Player's Handbook, see `content-packs.md`) are never part of the code and never
go to GitHub. Upload the file from your PC straight onto the server's disk:

```powershell
fly ssh sftp put server\data\content\phb.json /data/content/phb.json
```

It is picked up within a few seconds; players reload the page. If Fly refuses
because the file already exists, remove the old one first with
`fly ssh console -C "rm /data/content/phb.json"` and upload again.

**Backups.** Fly keeps automatic daily snapshots of the disk for a few days.
Still save a backup file of your campaign now and then (Configure, Backup): it
is a file in your own hands, and it also works on any other host.

**Looking at what the server does.** `fly status` shows whether it is awake,
`fly logs` shows its messages.

**The first visit is slow.** The server sleeps when nobody is connected and
needs a few seconds to wake up. A running session keeps it awake.

**Never run two servers.** There is one disk, so there must be one machine.
Do not use `fly scale count`, and always deploy with `--ha=false`.

**Switching it off for good.** `fly apps destroy YOUR-NAME` deletes the app
**and the disk with everything on it**. Save backup files first.

## For the curious: how it is built

- `Dockerfile` builds the client and packs it together with the server into
  one container. `fly.toml` tells Fly how to run it: one small machine in
  Frankfurt, HTTPS only, a 1 GB disk mounted at `/data`, a health check on
  `/api/health`, sleep when idle.
- Everything that must survive lives on the disk: `/data/dnd.sqlite`
  (accounts, characters, campaigns, sessions, log), `/data/uploads` (handout
  pictures), `/data/content` (private content packs). `.dockerignore` keeps
  your local `server/data` out of the container.
- Settings (environment variables): `PORT`, `DB_PATH`, `UPLOADS_DIR`,
  `CONTENT_DIR` are set in the `Dockerfile`; `INVITE_CODE` is a Fly secret.
- Another host works the same way as long as it runs a Dockerfile and gives
  you a permanent disk mounted at `/data` (for example Render with a paid
  instance and a disk). Hosts whose free plan forgets files on every restart
  would lose your database.
