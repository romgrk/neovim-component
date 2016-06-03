var path = require('path');
const {join, resolve} = path;

var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;

var win;

var index_html = 'file://' + join(__dirname, 'index.html');
var index_rel = join('example', 'minimal', 'index.html');
var index_bs = 'http://localhost:3000/' + join('example', 'minimal', 'index.html');

var bs = require('browser-sync').create();
bs.watch("*.css").on("change", bs.reload);
bs.watch("*.js").on("change",  bs.reload);
bs.init({
    server: {
        baseDir: path.resolve(__dirname, "../.."),
        index: index_rel,
        /* routes: {
         *     "/neovim":       "../neovim-component",
         * } */
    },
    files: [
        "neovim-editor.html",
        "example/minimal/index.html",
        "build/*",
        // "../../.config/nyaovim/init.js",
        // "../../.config/nyaovim/nyaovimrc.html"
    ]
});

app.on('ready', function() {
    win = new BrowserWindow({
        width: 800,
        height: 600,
        useContentSize: true,
        webPreferences: {
            blinkFeatures: 'KeyboardEventKey'
        }
    });

    win.on('closed', function() {
        win = null;
        app.quit();
    });

    setTimeout( () => {
        win.loadURL(index_bs);
        win.webContents.openDevTools({detach: true});
    }, 1000);
});
