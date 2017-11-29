'use strict';

var execFile = require('child_process').execFile;
var fs = require('fs');
var webpBinPath = require('cwebp-bin');
var mime = require('mime');
var crypto = require('crypto');
var path = require('path');
var mkdirp = require('mkdirp');
var vary = require('vary');
var urlParse = require('url').parse;

var extenstions = [
  '.jpg',
  '.png',
  '.tiff'
];

var supportedMimes = [
  'image/jpeg',
  'image/png',
  'image/tiff'
];

var _tempCache = [];

var send = function send(res, path, cb) {
  var sendMethod = typeof res.sendFile === 'undefined' ?
    res.sendfile :
    res.sendFile;
  vary(res, 'Accept');
  sendMethod.call(res, path, cb);
}

var sendAndSave = function sendAndSave(res, path, cb) {
  _tempCache.push(path);
  send(res, path, cb);
};

module.exports = function(basePath, options) {
  // use custom dir or choose default
  options = options || {};
  var cacheDir = options.cacheDir ?
    options.cacheDir :
    path.join(process.cwd(), 'webp-cache');

  // compute options in external file
  var optionArr = require('./compute-options')(options);

  // create cache dir if not exists
  var cachePathExists = fs.existsSync(path.join(cacheDir));
  if (!cachePathExists) {
    mkdirp.sync(path.join(cacheDir));
  }

  /**
   * handles each request and sends a webp image format if the client supports it
   */
  return function webpMiddleware(req, res, next) {
    var url = req.url;
    var pathname = urlParse(req.url).pathname;
    var extpos = pathname.lastIndexOf('.');
    var ext = pathname.substr(extpos);
    var imgPath = path.join(basePath, req.originalUrl);

    if (options.serveWebp && ext == '.webp') {
      ext = extenstions.find(ext => {
        var potentialImgPath = imgPath.substr(0, imgPath.length - ext.length - 1) + ext;
        try {
          return fs.statSync(potentialImgPath) ? ext : false;
        } catch (error) {
          return false;
        }
      })
      if (ext) {
        req.url = url.replace('.webp', ext);
        webpMiddleware(req, res, next);
        return;
      }
      next();
    }

    var mimeType = mime.lookup(req.originalUrl);
    var pathOptions = [];
    var accept = req.headers.accept;

    var hasMimetype = supportedMimes.indexOf(mimeType) !== -1;
    var acceptWebp = accept && accept.indexOf('image/webp') !== -1;

    // just move on if mimetypes does not match
    if (!hasMimetype || !acceptWebp) {
      next();
      return;
    }

    var hash = crypto.createHash('md5').update(req.originalUrl).digest('hex');
    var cachePath = path.join(cacheDir, hash + '.webp');
    

    // try lookup cache for fast access
    if (_tempCache.indexOf(cachePath) !== -1) {
      send(res, cachePath, function(err) {
        if (err) {
          _tempCache.splice(_tempCache.indexOf(cachePath), 1);
          webpMiddleware(req, res, next);
        }
      });
      return;
    }

    fs.exists(cachePath, function(exists) {
      if (exists) {
        sendAndSave(res, cachePath);
        return;
      }
      pathOptions.push(imgPath);
      pathOptions = pathOptions.concat(optionArr);
      pathOptions.push('-o');
      pathOptions.push(cachePath);

      execFile(webpBinPath, pathOptions, function(err) {
        if (err) {
          console.error(err);
          next();
          return;
        }
        sendAndSave(res, cachePath);
      });
    });
  };
};
