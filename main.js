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
  Menu
} = require('electron')

// Initialize global variables early - BEFORE any windows are created
global.workdirObj = { prop1: null };
global.token = { thetoken: null };

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

function getAuthConfig() {
  var authConfig = {
    clientId: 'XB0zarh086Hr8vx6m3G3sQZz2SAaOjrQ', //new
    authorizeEndpoint: 'https://ultrasoundjelly.auth0.com/authorize',
    audience: 'https://ultrasoundjelly.auth0.com/userinfo',
    scope: 'openid',
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
    backgroundColor: '#111118', // Fallback color
  });
  authWindow.setResizable(false);

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