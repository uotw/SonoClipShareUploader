'use strict';

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _events = require('events');

var _events2 = _interopRequireDefault(_events);

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _AuthService = require('./js/AuthService');

var _AuthService2 = _interopRequireDefault(_AuthService);

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {
    default: obj
  };
}

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  nativeTheme
} = require('electron')

// Initialize global variables early - BEFORE any windows are created
global.workdirObj = { prop1: null };
// thetoken   -- the ID token, for the ?token= upload endpoints (unchanged)
// apitoken   -- the API access token, for Authorization: Bearer
// Kept as separate fields rather than one "the token", because which one is
// correct depends entirely on who is being called. See getAuthConfig().
global.token = { thetoken: null, apitoken: null };

// const log = require('electron-log');
// log.initialize({ spyRendererConsole: true});
// log.info('Hello, log');

// const Menu = electron.Menu
require('@electron/remote/main').initialize()

const { autoUpdater } = require('electron-updater');
const { safeStorage } = require('electron');
const ElectronStoreMain = require('electron-store');
const authStore = new ElectronStoreMain({ name: 'auth' });
// The renderer's own store (default name), where the theme preference lives.
const prefsStore = new ElectronStoreMain();

// THE WINDOW CHROME, NOT JUST THE PAGE.
//
// The title bar, the traffic lights and the flash of colour before the first
// paint are all native, and none of them are reached by css/themes.css. Left
// alone they stayed light while the app went dark, so a dark page sat inside a
// white frame.
//
// This also removes `nativeTheme.themeSource = 'light'`, which existed for the
// EMBEDDED Auth0/Apple sign-in pages -- they follow prefers-color-scheme and
// rendered unreadably in Dark Mode. Sign-in happens in the user's browser now,
// so there is nothing left in this app that wants forcing to light.
function currentThemeIsClassic() {
  try {
    return prefsStore.get('theme') === 'classic';
  } catch (e) {
    return false;   // dark is the default
  }
}

function applyNativeTheme() {
  var classic = currentThemeIsClassic();
  nativeTheme.themeSource = classic ? 'light' : 'dark';
  return classic ? '#ffffff' : '#282828';
}

// STAYING SIGNED IN.
//
// Auth0 already returns a refresh token -- `offline_access` is in the requested
// scope -- and the app used to drop it on the floor, which is the only reason a
// full sign-in was needed on every launch.
//
// Kept in its own store file, encrypted with safeStorage: the OS Keychain on
// macOS, DPAPI on Windows. electron-store writes plaintext JSON, which is the
// wrong home for a credential that does not expire on its own. If encryption is
// unavailable (a Linux box with no keyring, say) NOTHING is written -- an
// unencrypted refresh token on disk is worse than signing in again.
var REFRESH_KEY = 'refreshToken';

function saveRefreshToken(token) {
  if (!token) { return; }
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage unavailable — not persisting the refresh token.');
    return;
  }
  try {
    authStore.set(REFRESH_KEY, safeStorage.encryptString(token).toString('base64'));
  } catch (e) {
    console.error('Could not store the refresh token:', e && e.message);
  }
}

function loadRefreshToken() {
  var blob = authStore.get(REFRESH_KEY);
  if (!blob || !safeStorage.isEncryptionAvailable()) { return null; }
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch (e) {
    // Written by another machine or another user's keychain: unusable, so bin
    // it rather than failing this launch and every one after it.
    console.warn('Stored credential could not be decrypted — clearing it.');
    clearRefreshToken();
    return null;
  }
}

function clearRefreshToken() {
  try { authStore.delete(REFRESH_KEY); } catch (e) {}
}

const os = require('os');
const isWindows = os.platform() === "win32";
if (isWindows) {
  var mainWindowHeight = 780;
} else {
  var mainWindowHeight = 750;
}

// TWO TOKENS, ONE SIGN-IN.
//
// The upload endpoint and the API authenticate differently and cannot share a
// token:
//
//   uploadapp5.php  ?token=<ID token>      -> POSTed to Auth0 /tokeninfo,
//                                             which only accepts id_tokens
//   /api/v1/...     Authorization: Bearer  -> verified locally against JWKS,
//                                             and requires aud = the API's id
//
// Asking for the API audience while KEEPING `openid` in scope returns both in
// one exchange: an id_token because of openid, and an API access_token because
// of the audience. So the picker can use the API without changing a single
// server file on the upload path.
//
// AUDIENCE IS A NAME, NOT AN ADDRESS. api.sonoclipshare.com has no DNS record
// and serves nothing; the string is just what the API was called when it was
// registered, and the server compares it literally (SonoClipApi.php ~:1594).
// The trailing slash is part of it -- drop it and every call 401s. It must
// match the phone app's src/config/auth0Config.js byte for byte.
//
// offline_access asks for a refresh token. Without it the access_token expires
// mid-session and a long study upload dies on a 401 that reads like a server
// fault. Needs "Allow Offline Access" enabled on the API in Auth0.
var SCS_API_AUDIENCE = 'https://api.sonoclipshare.com/';

// AUTH0 REDIRECTS TO HTTPS; HTTPS HANDS OFF TO THE DEEPLINK.
//
// Pointing Auth0 straight at sonoclipshare:// works, but costs an "Authorize
// App" confirmation on EVERY sign-in. Auth0's own words:
//
//   "Even when consent is skipped for first-party applications, a login
//    confirmation prompt may still appear when the application uses a
//    non-verifiable callback URI (such as localhost or a custom URI scheme)."
//
// A custom scheme cannot be proven to belong to anyone, so the user is asked to
// vouch for it. Loopback is in the same category, so it is not an escape. The
// only callback form that skips the prompt is HTTPS on a domain Auth0 can
// verify -- so the redirect goes to server/appauth.php, which immediately
// bounces to the deeplink below.
//
// PKCE is what makes the bounce safe: the code is useless without the verifier,
// which never leaves this process.
//
// BOTH must be in the Auth0 application's Allowed Callback URLs -- the HTTPS one
// because it is what /authorize is asked for, and the scheme is declared to the
// OS by the electron-builder `protocols` entry.
var SCS_PROTOCOL = 'sonoclipshare';
var SCS_DEEPLINK_URI = SCS_PROTOCOL + '://callback';
var SCS_REDIRECT_URI = 'https://www.sonoclipshare.com/appauth.php';

function getAuthConfig() {
  var authConfig = {
    clientId: 'XB0zarh086Hr8vx6m3G3sQZz2SAaOjrQ', //new
    authorizeEndpoint: 'https://ultrasoundjelly.auth0.com/authorize',
    audience: SCS_API_AUDIENCE,
    scope: 'openid offline_access',
    redirectUri: SCS_REDIRECT_URI,
    // What comes BACK to the app -- see isValidAccessCodeCallBackUrl.
    deeplinkUri: SCS_DEEPLINK_URI,
    tokenEndpoint: 'https://ultrasoundjelly.auth0.com/oauth/token'
  };
  return authConfig;
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var mainWindow = void 0;
var authWindow;

function createmainWindow(token, authWindow) {
  // Guarded: on the silent-resume path there is no auth window to close,
  // because the browser was never opened.
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
  }
  
  //console.log('createmainWindow called with token:', typeof token, token ? token.substring(0, 100) + '...' : 'null');
  
  mainWindow = new BrowserWindow({
    width: 1100,
    height: mainWindowHeight,
    // Theme-matched, so the window does not flash white before the page paints.
    backgroundColor: applyNativeTheme(),
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false
    }
  });

  mainWindow.setResizable(false);

  // External links open in the user's default browser, not an in-app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // and load the index.html of the app.
  mainWindow.loadURL('file://' + __dirname + '/index.html', {
    userAgent: 'Chrome'
  });

  try {
    var responsetoken = JSON.parse(token);
    // console.log('Parsed token object:', Object.keys(responsetoken));
    // console.log('id_token present:', !!responsetoken.id_token);
    // console.log('access_token present:', !!responsetoken.access_token);
    
    // Try id_token first, then access_token as fallback
    var tokenValue = responsetoken.id_token || responsetoken.access_token;

    // The API token is kept SEPARATELY and is never used as a fallback for the
    // upload endpoints: /tokeninfo rejects an access_token, so falling back
    // would turn a working upload into a confusing 401.
    global.token.apitoken = responsetoken.access_token || null;

    // The whole point of `offline_access`. Auth0 rotates refresh tokens, so a
    // refresh response carries a NEW one -- store whichever arrives, or the
    // next launch presents a token that has already been spent.
    saveRefreshToken(responsetoken.refresh_token);

    if (tokenValue) {
      // Update existing global token (don't create new object)
      global.token.thetoken = tokenValue;
      // console.log('Token set successfully. Length:', tokenValue.length);
      // console.log('Token preview:', tokenValue.substring(0, 20) + '...');
    } else {
      // console.error('No id_token or access_token found in response');
      // console.log('Full response object:', responsetoken);
    }
    
  } catch (parseError) {
    // console.error('Error parsing token:', parseError);
    // console.log('Raw token received:', token);
  }

  // workdirObj is already created globally, no need to recreate
  mainWindow.on('close', function(event) {
    //event.preventDefault();
    if (global.workdirObj.prop1) {
      // console.log('removing the ' + global.workdirObj.prop1 + ' directory.');
      var spawnsync = require('child_process').spawnSync;
      spawnsync("rm", ['-rf', global.workdirObj.prop1]);
    }
  });

  // Updates are checked once the app is actually up, and never during sign-in:
  // a background download must not compete with the first upload of a session.
  setTimeout(initAutoUpdater, 8000);

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
}

/**
 * Background updates, via electron-updater against the GitHub Releases the
 * workflow already publishes.
 *
 * WHY NOT PATCH ASSETS INSTEAD. Replacing js/css/html at runtime would mean
 * loading code from a writable directory into a renderer that has
 * nodeIntegration -- i.e. remote code with require('child_process') on machines
 * that handle PHI -- and it cannot touch the bundle anyway, because
 * hardenedRuntime + Developer ID signing means any edit inside the .app breaks
 * the signature. electron-updater keeps the whole chain (signed, notarized)
 * and the .blockmap the build already emits makes the download differential, so
 * a CSS-only release transfers a fraction of the DMG.
 *
 * NEVER RESTARTS BY ITSELF. autoInstallOnAppQuit means the update lands when
 * the user next quits. Nothing here calls quitAndInstall(): this app can be
 * midway through de-identifying and uploading a study, and no update is worth
 * interrupting that.
 *
 * AND NEVER DOWNLOADS WITHOUT BEING ASKED. autoDownload is off. An update is
 * ~110MB, and this app's users are on hospital and clinic connections where
 * that competes directly with the study they are trying to upload -- the very
 * thing they opened the app to do. So the first time an update appears the user
 * chooses, once, and the answer is remembered:
 *
 *   updateMode 'auto'   -- fetch in the background from now on
 *   updateMode 'manual' -- tell me, and I will decide each time
 *
 * Even in 'auto' the download waits for the upload pipeline to be idle; see
 * startDownloadWhenIdle(). A skipped version is remembered so it is not offered
 * again, while later versions still are.
 */
var UPDATE_MODE_KEY = 'updateMode';
var SKIPPED_VERSION_KEY = 'skippedVersion';
var pipelineBusy = false;
var pendingDownload = false;

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** Download now if nothing is uploading, otherwise as soon as that finishes. */
function startDownloadWhenIdle() {
  if (pipelineBusy) {
    pendingDownload = true;
    return;
  }
  pendingDownload = false;
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('Update download failed:', err && err.message ? err.message : err);
  });
}

function askAboutUpdates(version) {
  var target = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
  var opts = {
    type: 'question',
    title: 'Update available',
    message: 'SonoClipShare Uploader ' + version + ' is available.',
    detail: 'Updates are around 110 MB. On a slow connection, downloading one ' +
            'while you are uploading a study will slow the upload down.\n\n' +
            'You can change this later from the menu.',
    buttons: ['Download automatically from now on', 'Download this one only', 'Skip this version'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  };
  var p = target ? dialog.showMessageBox(target, opts) : dialog.showMessageBox(opts);
  return p.then(function (res) {
    if (res.response === 0) {
      prefsStore.set(UPDATE_MODE_KEY, 'auto');
      startDownloadWhenIdle();
    } else if (res.response === 1) {
      // One-off: they have chosen for this version, not for every future one.
      prefsStore.set(UPDATE_MODE_KEY, 'manual');
      startDownloadWhenIdle();
    } else {
      prefsStore.set(UPDATE_MODE_KEY, 'manual');
      prefsStore.set(SKIPPED_VERSION_KEY, version);
    }
  }).catch(function () {});
}

function onUpdateAvailable(info) {
  var version = info && info.version;
  if (!version) { return; }

  // Skipped means skipped -- for THAT version. A later one is still offered.
  if (prefsStore.get(SKIPPED_VERSION_KEY) === version) {
    return;
  }

  var mode = prefsStore.get(UPDATE_MODE_KEY);
  if (!mode) {
    askAboutUpdates(version);
  } else if (mode === 'auto') {
    startDownloadWhenIdle();
  } else {
    // Manual: they still hear about every release, they just decide when.
    sendToMain('update-offer', version);
  }
}

/**
 * electron-updater's own log, on disk.
 *
 * It reports the things that decide whether an update is a few megabytes or a
 * hundred -- most usefully `Download block maps (old: ..., new: ...)` and
 * whether the differential download succeeded or fell back. None of that
 * reaches a packaged app's stdout, so without this the only way to judge an
 * update is to watch a progress bar and guess.
 *
 * Kept permanently rather than as test scaffolding: when someone reports "the
 * update never arrives", this file is the first thing worth reading. Written to
 * Electron's standard logs directory (~/Library/Logs/<app> on macOS).
 */
function updaterLogger() {
  var fs = require('fs');
  var logPath = null;
  try {
    var dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = require('path').join(dir, 'updater.log');
  } catch (e) { /* logging must never break updating */ }

  function write(level, args) {
    var line = new Date().toISOString() + '  ' + level + '  ' +
      Array.prototype.map.call(args, function (a) {
        return (a && a.stack) ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a));
      }).join(' ');
    console.log('[updater] ' + line);
    if (logPath) { try { fs.appendFileSync(logPath, line + '\n'); } catch (e) {} }
  }

  return {
    info:  function () { write('info', arguments); },
    warn:  function () { write('warn', arguments); },
    error: function () { write('error', arguments); },
    debug: function () { write('debug', arguments); }
  };
}

function initAutoUpdater() {
  // In development there is no feed and electron-updater throws on the first
  // check. Nothing to update when running from source anyway.
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.logger = updaterLogger();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('update-downloaded', (info) => sendToMain('update-downloaded', info && info.version));

  // Logged, not surfaced. A failed update check is not the user's problem, and
  // the appversion.php banner still tells them a newer version exists.
  autoUpdater.on('error', (err) => {
    console.error('Auto-update failed:', err && err.message ? err.message : err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Auto-update check failed:', err && err.message ? err.message : err);
  });
}

// The renderer tells us when the de-identify/upload pipeline is running, so an
// update download never competes with the study the user is actually here for.
ipcMain.on('pipeline-busy', function (event, busy) {
  pipelineBusy = !!busy;
  if (!pipelineBusy && pendingDownload) {
    startDownloadWhenIdle();
  }
});

// "Download" on the manual banner.
ipcMain.on('download-update', function () {
  startDownloadWhenIdle();
});

// "Restart to update" on the banner.
//
// quitAndInstall() is otherwise never called: the update installs on quit, so
// nothing has to interrupt anyone. This is the user ASKING to restart, which is
// different -- but it still refuses mid-pipeline. Restarting during a
// de-identify/upload run would abandon a study half-uploaded, and the person
// clicking a small banner link is not thinking about that.
ipcMain.on('install-update', function () {
  if (pipelineBusy) {
    dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: 'warning',
      title: 'Upload in progress',
      message: 'Not restarting yet — an upload is still running.',
      detail: 'The update will install by itself when you quit, or you can ' +
              'restart once this study has finished uploading.',
      buttons: ['OK']
    }).catch(function () {});
    return;
  }
  // Give the window a moment to paint the click before it disappears.
  setTimeout(function () { autoUpdater.quitAndInstall(); }, 150);
});

// SIGN-IN HAPPENS IN THE USER'S BROWSER, NOT IN THIS APP.
//
// The authorize URL is opened with shell.openExternal and Auth0 returns through
// the sonoclipshare:// deeplink (see handleAuthCallback). Three things this
// buys, in order of how much they matter:
//
//   - Google is progressively refusing OAuth inside embedded webviews
//     (`disallowed_useragent`). An app that embeds Google sign-in is on borrowed
//     time; this is the flow Google and RFC 8252 both ask for.
//   - The browser already has the user's session, password manager and hardware
//     2FA. Nothing of that exists inside a fresh Electron window.
//   - It retires the v2.6.6 workaround: the CDP debugger that forced
//     prefers-color-scheme:light on every navigation existed ONLY because
//     Apple's "Sign in with Apple" page ignores nativeTheme when embedded. In
//     Safari or Chrome it renders correctly on its own, so that code is gone.
//
// The AuthService instance is module-level rather than local to this function,
// because the PKCE verifier is generated when the URL is built and needed again
// when the callback arrives -- and those are now two different events, not one
// closure.
var authService = null;

function createauthWindow() {
  authService = new _AuthService2.default(getAuthConfig());
  authWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    backgroundColor: applyNativeTheme(),
    // HIDDEN UNTIL WE KNOW IT IS NEEDED. A returning user is resumed from the
    // stored credential in a few hundred milliseconds and goes straight to the
    // main window, so showing a splash first only produces a flash of a screen
    // they did not need to read.
    show: false,
    webPreferences: {
      // Safe now, and only now: this window used to load Auth0 and Apple's
      // sign-in pages, which is why it had no Node access. It loads exactly one
      // local file today -- auth-loading.html -- and external links are denied
      // below, so nothing remote ever executes here.
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  authWindow.setResizable(false);

  // Open external links in the user's default browser instead of a cramped
  // in-app Electron window.
  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // This window is now only ever our own waiting screen: a spinner while the
  // browser is open, and somewhere to put an error if the exchange fails.
  authWindow.loadURL(`file://${__dirname}/auth-loading.html`);

  // RESUME FIRST, ASK SECOND.
  //
  // The splash is already up, so a returning user sees it for the length of one
  // token call and then lands in the app -- no browser, no Auth0, no tab to
  // close. Only if there is no usable stored session does this open the browser.

  var revealSplash = function () {
    if (authWindow && !authWindow.isDestroyed() && !authWindow.isVisible()) {
      authWindow.show();
    }
  };

  // SIGNING OUT MUST NOT IMMEDIATELY SIGN YOU BACK IN.
  //
  // Sign-out relaunches with this flag. Without it the fresh launch does what
  // every tokenless launch does -- opens the browser -- so the user is thrown
  // straight back at the login page they just left. Here they get a screen with
  // a button and decide for themselves.
  if (process.argv.indexOf('--signed-out') !== -1) {
    setSplashState('data-signed-out');
    revealSplash();
    return;
  }

  // SHOWN IMMEDIATELY, not after a delay.
  //
  // The 700ms timer was meant to spare returning users a splash they did not
  // need -- but the resume measures ~4s in practice, so what it actually did
  // was pop the window up at 700ms and yank it away at 4s. A window that
  // appears and vanishes is the flash; a window that is simply there, saying
  // "Signing you in...", is a loading screen. If the resume ever gets fast
  // enough to be imperceptible this can go back to being deferred.
  revealSplash();

  trySilentSignIn().then((resumed) => {
    if (resumed) {
      return;
    }
    revealSplash();
    openSignInInBrowser();
  });

  // NOTE: there is no webRequest interception any more. The callback no longer
  // travels through a window we own -- it arrives as an OS-level deeplink, in
  // handleAuthCallback below.
}

/**
 * Trade a stored refresh token for a fresh session, without any UI.
 *
 * Returns true if the app is signed in and the main window is up. Any failure
 * -- revoked, expired, rotated out from under us, offline -- returns false and
 * the caller falls back to the browser, which is the only correct response: a
 * refresh token is a convenience, never a requirement.
 *
 * The ID TOKEN matters as much as the access token here. uploadapp5.php POSTs
 * it to Auth0 /tokeninfo, which accepts ID tokens only, and it expires in ten
 * hours -- so a resumed session with no id_token would look signed in and fail
 * on the first upload. `openid` is in the original scope, so the refresh grant
 * returns one; if it ever does not, this refuses the resume rather than opening
 * a half-working app.
 */
function trySilentSignIn() {
  var refreshToken = loadRefreshToken();
  if (!refreshToken) {
    return Promise.resolve(false);
  }

  var cfg = getAuthConfig();
  return _axios2.default({
    method: 'POST',
    url: cfg.tokenEndpoint,
    headers: { 'content-type': 'application/json' },
    data: {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      refresh_token: refreshToken
    },
    timeout: 20000
  }).then(function (response) {
    if (!response.data || !response.data.id_token) {
      console.warn('Silent sign-in returned no id_token — falling back to the browser.');
      return false;
    }
    createmainWindow(JSON.stringify(response.data), authWindow);
    return true;
  }).catch(function (err) {
    var status = err && err.response && err.response.status;
    // 400/403 means the token is dead (revoked, expired, or already rotated).
    // Anything else is probably the network, and the stored token is still
    // good -- so only bin it when Auth0 has actually rejected it.
    if (status === 400 || status === 401 || status === 403) {
      console.warn('Stored session rejected by Auth0 — signing in again.');
      clearRefreshToken();
    } else {
      console.warn('Silent sign-in failed (' + (err && err.message) + ') — signing in again.');
    }
    return false;
  });
}

/**
 * Build the authorize URL and hand it to the default browser.
 *
 * ext-appversion: the login page shows the "new version available" banner, and
 * it used to read the version out of the User-Agent we set on the embedded
 * window ("Chrome - SonoClipShareUploader/x.y.z"). The system browser sends its
 * own UA, so the version has to travel as a parameter. Auth0 exposes
 * `ext-`-prefixed authorize params to Universal Login as
 * config.extraParams['ext-appversion'] -- which means the LIVE login page in
 * the Auth0 dashboard has to be updated to read it. Until it is, the banner
 * simply does not show; sign-in itself is unaffected.
 */
/** Flip the waiting screen into one of its states (see auth-loading.html). */
function setSplashState(attr) {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.webContents.executeJavaScript(
      "document.body.setAttribute('" + attr + "','1')"
    ).catch(() => {});
  }
}

function openSignInInBrowser() {
  // Now, and only now, is "continue in your browser" true.
  setSplashState('data-browser');

  var pjson = require('./package.json');
  var url = authService.requestAuthCode() +
            '&ext-appversion=' + encodeURIComponent(pjson.version);
  shell.openExternal(url);

  // GET OUT OF THE WAY ONCE THE USER IS IN THE BROWSER.
  //
  // The deeplink coming back ACTIVATES this app, and macOS brings its visible
  // window forward and paints it before any JavaScript of ours runs -- so
  // hiding on the callback is already too late. Measured: deeplink at +7612ms,
  // hidden at +7624ms, main window painted at +8066ms. The user sees the
  // waiting screen surface, disappear, and then a gap.
  //
  // Hiding on BLUR instead means there is nothing on screen to bring forward.
  // The waiting screen stays up for as long as the app is frontmost -- which is
  // exactly when the "continue in your browser" instruction is worth reading --
  // and disappears the moment they switch to the browser. Coming back then goes
  // straight to the app window.
  //
  // `once`, and only while we are still waiting: an error re-shows this window,
  // and it must not vanish again the next time focus moves.
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.once('blur', function () {
      if (authWindow && !authWindow.isDestroyed() && !handledCallback) {
        authWindow.hide();
      }
    });
  }
}

/**
 * The sonoclipshare:// deeplink coming back from the browser.
 *
 * Fires from 'open-url' on macOS and from 'second-instance' argv on Windows.
 * Guarded because both can deliver the same URL more than once (a re-activated
 * app, a duplicated launch), and a second exchange of an already-redeemed
 * authorization code fails -- which would look like a broken sign-in seconds
 * after a working one.
 */
var handledCallback = false;

function handleAuthCallback(url) {
  if (!url || url.indexOf(SCS_PROTOCOL + '://') !== 0) { return; }
  if (handledCallback) { return; }
  handledCallback = true;

  // HIDE IT, do not show it. The user is looking at their browser; the next
  // thing they should see is the app itself.
  //
  // Showing the waiting screen here meant the "Continue signing in in your
  // browser" message came BACK for the length of the token exchange, after they
  // had already finished in the browser -- the sign-in screen flashing again
  // just before the app opened. There is nothing to wait for that they need to
  // watch: createmainWindow opens and focuses the real window a moment later.
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.hide();
  }
  app.focus({ steal: true });

  authService.requestAccessCode(url, createmainWindow, authWindow)
    .catch((err) => {
      // Let the user try again rather than stranding them on a spinner.
      handledCallback = false;
      console.error('Token exchange failed:', err && err.message ? err.message : err);
      // Only now is there something to look at: bring the window back with the
      // failure state rather than leaving the user with nothing.
      if (authWindow && !authWindow.isDestroyed()) {
        setSplashState('data-auth-error');
        authWindow.show();
      }
    });
}

// OWN THE sonoclipshare:// SCHEME.
//
// In a packaged app the electron-builder `protocols` entry declares this to the
// OS at install time; this call is what makes it work in development, where the
// running binary is Electron itself. On Windows the executable path and the
// script argument have to be passed explicitly or the registry entry points at
// electron.exe with no app to open.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCS_PROTOCOL, process.execPath, [_path2.default.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(SCS_PROTOCOL);
}

// A SECOND COPY MUST NOT START.
//
// On Windows a deeplink launches the app again and the URL arrives in the new
// process's argv; without this lock that second copy would open its own window
// and the first would sit waiting forever. The lock hands the URL to the
// running instance instead. Also stops two signed-in windows generally.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    // Windows/Linux: the deeplink is one of the arguments.
    const url = argv.find((a) => typeof a === 'string' && a.startsWith(SCS_PROTOCOL + '://'));
    if (url) { handleAuthCallback(url); }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) { mainWindow.restore(); }
      mainWindow.focus();
    }
  });
}

// macOS delivers deeplinks here, and can do so BEFORE 'ready' on a cold start,
// which is why this listener is registered at load rather than inside it.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
//app.on('ready', createmainWindow)
app.on("ready", function() {
  // Match the native chrome to the app's own theme -- see applyNativeTheme().
  applyNativeTheme();
  createauthWindow();
  var menu = Menu.buildFromTemplate([{
    label: 'Menu',
    submenu: [{
        label: 'About',
        click() {
          var aboutWindow = new BrowserWindow({
            // 600x400 cut the credits off and forced a scroll on a page that is
            // mostly a list of links.
            width: 720,
            height: 700,
            resizable: true,
            title: 'About SonoClipShare Uploader',
            backgroundColor: applyNativeTheme(),
            webPreferences: {
              nodeIntegration: true,
              contextIsolation: false,
              enableRemoteModule: true
            }
          });
          // The version travels as a query parameter -- see the note at the
          // bottom of about.html.
          aboutWindow.loadURL(`file://${__dirname}/about.html?v=` +
                              encodeURIComponent(app.getVersion()));
          //aboutWindow.webContents.openDevTools();
        }
      },
      {
        label: 'Check for Updates…',
        click() {
          if (!app.isPackaged) {
            dialog.showMessageBox({ type: 'info', message: 'Updates are only available in an installed build.' });
            return;
          }
          // An explicit check should answer even when there is nothing to say --
          // silence would be indistinguishable from a broken updater.
          autoUpdater.once('update-not-available', function () {
            dialog.showMessageBox({
              type: 'info',
              title: 'No update',
              message: 'You are on the latest version (' + app.getVersion() + ').'
            });
          });
          autoUpdater.checkForUpdates().catch(function (err) {
            dialog.showMessageBox({
              type: 'warning',
              title: 'Could not check for updates',
              message: err && err.message ? err.message : String(err)
            });
          });
        }
      },
      {
        label: 'Update Settings…',
        click() {
          var mode = prefsStore.get(UPDATE_MODE_KEY) || 'not set';
          dialog.showMessageBox({
            type: 'question',
            title: 'Updates',
            message: 'How should updates be downloaded?',
            detail: 'Currently: ' + (mode === 'auto' ? 'automatically' :
                                     mode === 'manual' ? 'ask me each time' : 'not chosen yet') +
                    '.\n\nUpdates are around 110 MB and always install when you quit, never mid-session.',
            buttons: ['Download automatically', 'Ask me each time', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            noLink: true
          }).then(function (res) {
            if (res.response === 0) { prefsStore.set(UPDATE_MODE_KEY, 'auto'); }
            else if (res.response === 1) { prefsStore.set(UPDATE_MODE_KEY, 'manual'); }
            // Choosing again clears a previous skip -- they are re-engaging.
            if (res.response !== 2) { prefsStore.delete(SKIPPED_VERSION_KEY); }
          }).catch(function () {});
        }
      },
      {
        label: 'DevTools',
        click() {
          if (mainWindow) {
            mainWindow.webContents.openDevTools();
          } else if (authWindow) {
            authWindow.webContents.openDevTools();
          }
        }
      },
      {
        label: 'Reload',
        click() {
          app.relaunch()
          app.exit()
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Exit',
        click() {
          app.quit()
        }
      }
    ]
  }])
  Menu.setApplicationMenu(menu);
});

// Quit when all windows are closed.
// SIGN OUT: forget the stored session and start over.
//
// Relaunches rather than just quitting, so the user sees the sign-in screen and
// knows it worked. NOTE this does not touch the Auth0 session cookie in their
// BROWSER -- signing in again will not re-ask for a password. Ending that would
// mean opening /v2/logout in the browser, which also signs them out of
// sonoclipshare.com in that browser; that is a bigger decision than this button.
// The renderer flipped the theme; bring the native chrome with it rather than
// waiting for the next launch.
// The "Sign in" button on the signed-out screen.
ipcMain.on('start-sign-in', function () {
  openSignInInBrowser();
});

ipcMain.on('theme-changed', function () {
  applyNativeTheme();
});

ipcMain.on('sign-out', function () {
  clearRefreshToken();
  app.relaunch({ args: process.argv.slice(1).concat(['--signed-out']) });
  app.exit(0);
});

// QUITS ON CLOSE, INCLUDING ON macOS.
//
// The Mac convention is to stay resident until Cmd+Q, which suits documents and
// editors. This is a single-purpose tool: you sign in, de-identify a study,
// upload it, and you are done. Leaving it running with no window is also the
// wrong default for something that holds an authenticated session on a machine
// that may be shared -- and there is no tray icon, so a resident app with no
// window is invisible rather than convenient.
app.on('window-all-closed', function() {
  app.quit();
});

// Kept for the case where the app is activated while still running with its
// window closed -- rare now that closing quits, but harmless and cheap.
app.on('activate', function() {
  if (mainWindow !== null) { return; }

  // Signing in, and the window was hidden when they left for the browser --
  // clicking the dock icon should show it again rather than appear to do
  // nothing.
  if (authWindow && !authWindow.isDestroyed()) {
    if (!authWindow.isVisible()) { authWindow.show(); }
    return;
  }

  createauthWindow();
});

app.on('browser-window-created', (_, win) => {
  require("@electron/remote/main").enable(win.webContents)
  const ElectronStore = require('electron-store');
  ElectronStore.initRenderer();
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

ipcMain.on('focusnow', event => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.setAlwaysOnTop(false);
    app.focus();
  }
})