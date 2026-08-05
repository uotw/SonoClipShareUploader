'use strict';

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _events = require('events');

var _events2 = _interopRequireDefault(_events);

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

function getAuthConfig() {
  var authConfig = {
    clientId: 'XB0zarh086Hr8vx6m3G3sQZz2SAaOjrQ', //new
    authorizeEndpoint: 'https://ultrasoundjelly.auth0.com/authorize',
    audience: SCS_API_AUDIENCE,
    scope: 'openid offline_access',
    redirectUri: 'https://ultrasoundjelly.auth0.com/mobile',
    tokenEndpoint: 'https://ultrasoundjelly.auth0.com/oauth/token'
  };
  return authConfig;
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var mainWindow = void 0;
var authWindow;

function createmainWindow(token, authWindow) {
  // Create the browser window.
  authWindow.close();
  
  //console.log('createmainWindow called with token:', typeof token, token ? token.substring(0, 100) + '...' : 'null');
  
  mainWindow = new BrowserWindow({
    width: 1100,
    height: mainWindowHeight,
    backgroundColor: '#fff',
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

function createauthWindow() {
  var authService = new _AuthService2.default(getAuthConfig());
  authWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    backgroundColor: '#ffffff',
  });
  authWindow.setResizable(false);

  // Apple's "Sign in with Apple" page ignores nativeTheme in the embedded view and
  // follows the OS Dark Mode, rendering unreadable dark text. Force the CSS
  // prefers-color-scheme to light at the renderer level via the DevTools protocol,
  // and re-apply on every navigation (loading page -> Auth0 -> Apple).
  try {
    authWindow.webContents.debugger.attach('1.3');
    var forceLight = function () {
      try {
        authWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'light' }]
        });
      } catch (e) {}
    };
    forceLight();
    authWindow.webContents.on('did-start-navigation', forceLight);
    authWindow.webContents.on('did-navigate', forceLight);
    authWindow.webContents.on('did-navigate-in-page', forceLight);
  } catch (e) {}

  // Open external links (e.g. the "new version available" banner) in the user's
  // default browser instead of a cramped in-app Electron window.
  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load your custom loading page first
  authWindow.loadURL(`file://${__dirname}/auth-loading.html`);

  // Navigate to auth after a short delay
  setTimeout(() => {
    var pjson = require('./package.json');
    var useragent = "Chrome - SonoClipShareUploader/" + pjson.version;
    authWindow.loadURL(authService.requestAuthCode(), {
      userAgent: useragent
    });
  }, 1500); // Show loading for 1.5 seconds

  // Rest of your existing code...
  const ses = authWindow.webContents.session;
  ses.webRequest.onCompleted({
    urls: ['https://ultrasoundjelly.auth0.com/mobile*']
  }, (details) => {
    authService.requestAccessCode(details.url, createmainWindow, authWindow);
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
//app.on('ready', createmainWindow)
app.on("ready", function() {
  // Force light appearance so the embedded Apple "Sign in with Apple" / Auth0 web
  // pages (which follow prefers-color-scheme) render readable instead of a dim dark
  // theme when macOS is in Dark Mode. The uploader's own UI uses fixed colors, so
  // this only affects the embedded auth pages.
  nativeTheme.themeSource = 'light';
  createauthWindow();
  var menu = Menu.buildFromTemplate([{
    label: 'Menu',
    submenu: [{
        label: 'About',
        click() {
          var aboutWindow = new BrowserWindow({
            width: 600,
            height: 400,
            'resizable': true,
            webPreferences: {
              nodeIntegration: true,
              contextIsolation: false,
              enableRemoteModule: true
            }
          });
          aboutWindow.loadURL(`file://${__dirname}/about.html`);
          //aboutWindow.webContents.openDevTools();
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
app.on('window-all-closed', function() {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function() {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    //createmainWindow()
    createauthWindow();
  }
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