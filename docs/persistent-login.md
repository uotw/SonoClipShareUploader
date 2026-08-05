# Staying signed in, and moving auth to the system browser

Status: **not implemented.** Design note for a future release. Written 2026-08-05.

Two changes that are usually discussed separately but belong together:

1. **Persistent login** — the app stops asking you to sign in on every launch, the
   way Slack and Spotify don't.
2. **System-browser OAuth** — the sign-in page opens in the user's real browser
   instead of an embedded Electron window.

(1) is the value. (2) is what makes (1) sit on solid ground, and it retires two
workarounds on the way.

---

## 1. Persistent login

### Most of this already works

The app requests `scope: 'openid offline_access'` (`main.js`, `getAuthConfig`),
so **Auth0 already returns a refresh token on every sign-in.** Confirmed from a
real token response on 2026-08-05: the payload carries `access_token`,
`refresh_token`, `id_token`, `scope: 'openid offline_access'`, `expires_in`.

`createmainWindow()` then keeps `id_token` and `access_token` in
`global.token` and **drops `refresh_token` on the floor** — nothing reads it,
nothing stores it. That is the entire reason a fresh sign-in is needed every
launch. The credential that would prevent it is already in hand.

So the work is not "add refresh tokens". It is "keep the one we already get".

### What has to be built

**Store it, encrypted.** `electron-store` is already a dependency (crop settings,
theme) but writes plaintext JSON into userData — wrong place for a credential
that does not expire on its own. Use Electron's `safeStorage`
(`encryptString`/`decryptString`, Keychain on macOS, DPAPI on Windows;
available since Electron 15, this app is on 25). Store the ciphertext via
`electron-store`, never the token.

**Try a silent refresh before showing any UI.** On launch, if a stored refresh
token exists, POST to `/oauth/token` with `grant_type=refresh_token` and go
straight to the main window. Only fall back to interactive sign-in when that
fails — revoked, expired, or the user signed out elsewhere.

**Refresh the ID token too, not just the access token.** This app needs BOTH,
for different endpoints:

| token | used by | why |
|---|---|---|
| `id_token` | `uploadapp5.php?token=` | the endpoint POSTs it to Auth0 `/tokeninfo`, which accepts ID tokens only |
| `access_token` | `/api/v1/mobile.php` (`Authorization: Bearer`) | verified locally against JWKS; needs `aud = https://api.sonoclipshare.com/` |

A `refresh_token` grant returns a new `id_token` as long as `openid` was in the
original scope, which it is. Do not let the two drift: `main.js:133` already has
an `id_token || access_token` fallback that would quietly hand the API token to
`/tokeninfo`, which rejects it. See the note in `js/AuthService.js` —
that aliasing was removed there for exactly this reason and the fallback in
`main.js` is the last one left.

`id_token` lifetime today is **10 hours** (observed `exp - iat = 36000`), so a
long-running session needs the refresh path even without persistence across
launches — an overnight upload session can outlive the token it started with.

**Auth0 dashboard changes.** Refresh token behaviour is tenant/API
configuration, not code: absolute and inactivity lifetimes, and **rotation**,
which is what you want for a desktop app (a public client with no secret). The
"stays signed in for weeks" behaviour is set here, not in the app.

**A way out.** There is `#logout` styling in `style.css` but no logout control in
`index.html`. Persistent login makes one mandatory: it must clear the stored
refresh token and ideally revoke it server-side. Shared workstations are a real
scenario for this app.

---

## 2. System-browser OAuth (RFC 8252)

### Why bother

- **Google is closing the door on embedded webviews for OAuth.** Today it works;
  the direction of travel is `disallowed_useragent`. A desktop app that embeds
  Google sign-in is on borrowed time.
- **The user's real browser has their session**, password manager and hardware
  2FA. With persistent login the browser trip happens rarely, so its one cost —
  leaving the app briefly — stops mattering.
- **It retires the v2.6.6 hack.** `createauthWindow()` attaches a CDP debugger
  and forces `prefers-color-scheme: light` on every navigation, purely because
  Apple's "Sign in with Apple" page ignores `nativeTheme` inside an embedded
  view. In Safari or Chrome that page renders correctly on its own. The
  `nativeTheme.themeSource = 'light'` line in `app.on("ready")` goes with it —
  though check it is not doing anything else first now that the app has its own
  dark theme.

### What it involves

Open the authorize URL with `shell.openExternal`, and get the callback back via
either a **custom protocol** (`sonoclipshare://callback`, registered with
`app.setAsDefaultProtocolClient`) or a **localhost loopback** listener. Loopback
avoids protocol registration entirely and is what the RFC prefers; a custom
protocol survives a firewall-restricted machine. PKCE is already implemented
(`js/AuthService.js`) and is unchanged either way.

### Two things in this codebase that break, and must move

1. **The update banner reads the app version from the User-Agent.**
   `createauthWindow()` sets `Chrome - SonoClipShareUploader/<version>` on the
   auth window, and `auth0/login.html` parses it to decide whether to show the
   orange "new version available" banner. The system browser sends its own UA,
   so the version has to travel another way — a query parameter on the authorize
   URL is the obvious one. **Both sides change**: the app, and the live login
   page in the Auth0 dashboard (`auth0/login.html` here is only a reference
   copy).
2. **The redirect interception disappears.** `webRequest.onCompleted` on
   `https://ultrasoundjelly.auth0.com/mobile*` is what currently detects the
   callback. That becomes a protocol handler (`open-url` on macOS,
   `second-instance` argv on Windows) or the loopback server. Both need testing
   on both platforms — this is the tail on the project, not the OAuth part.

Also worth knowing: the Auth0 redirect page's entire body is the text `OK`. The
app hides the auth window before the token exchange so it does not flash
(`main.js`, `onCompleted`). In the system-browser flow that page is visible in
the user's browser tab instead, so it wants to become a real "you can close this
and return to SonoClipShare Uploader" page.

---

## Sequencing

Do them in this order, and each is shippable on its own:

1. **Persist the refresh token** (safeStorage + silent refresh at launch). Small,
   self-contained, delivers the entire user-visible benefit, and does not touch
   the sign-in mechanism. Needs a logout control alongside it.
2. **Move to the system browser.** Larger, and mostly about the callback
   plumbing and the UA/version change rather than the OAuth itself. Best done
   once (1) means users meet it rarely.

Doing (2) first would be doing the harder half for none of the benefit.
