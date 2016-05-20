"use strict";
exports.NODE_ENV = (function () {
    try {
        return global.require('remote').process.env.NODE_ENV;
    }
    catch (e) {
        return 'production';
    }
})();
var LogLevel = 'info';
if (exports.NODE_ENV === 'production') {
    LogLevel = 'warn';
}
else if (exports.NODE_ENV === 'debug') {
    LogLevel = 'debug';
}
var log = require('loglevel');
log.setLevel(LogLevel);
