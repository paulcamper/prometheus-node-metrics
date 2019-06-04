'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = initMetrics;

var _promClient = require('prom-client');

var _promClient2 = _interopRequireDefault(_promClient);

var _basicAuth = require('basic-auth');

var _basicAuth2 = _interopRequireDefault(_basicAuth);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var STAGE = process.env.STAGE || 'dev';
var PROMETHEUS_USERNAME = process.env.PROMETHEUS_USERNAME;
var PROMETHEUS_PASSWORD = process.env.PROMETHEUS_PASSWORD;
var PROMETHEUS_ENABLED = process.env.PROMETHEUS_ENABLED;
var PROMETHEUS_PUSH_ENABLED = process.env.PROMETHEUS_PUSH_ENABLED;
var PROMETHEUS_PUSH_USERNAME = process.env.PROMETHEUS_PUSH_USERNAME;
var PROMETHEUS_PUSH_PASSWORD = process.env.PROMETHEUS_PUSH_PASSWORD;
var PROMETHEUS_PUSH_URL = process.env.PROMETHEUS_PUSH_URL;
var PROMETHEUS_PUSH_RATE = process.env.PROMETHEUS_PUSH_RATE || 10000;
var DYNO = process.env.DYNO || 'test';
var HEROKU_APP_NAME = process.env.HEROKU_APP_NAME;

var collectDefaultMetrics = _promClient2.default.collectDefaultMetrics;

var Registry = _promClient2.default.Registry;
var register = new Registry();
collectDefaultMetrics({ register: register });

// Collect requests duration info
var httpRequestDurationMicroseconds = new _promClient2.default.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['route'],
  // buckets for response time from 0.1ms to 500ms
  buckets: [0.10, 5, 15, 50, 100, 200, 300, 400, 500]
});

function registerRoute(app) {
  // Runs before each requests
  app.use(function (req, res, next) {
    res.locals.startEpoch = Date.now();
    next();
  });

  app.get('/metrics', function (req, res) {
    var credentials = (0, _basicAuth2.default)(req);
    if (!credentials || credentials.name !== PROMETHEUS_USERNAME || credentials.pass !== PROMETHEUS_PASSWORD) {
      res.status(401);
      res.header('WWW-Authenticate', 'Basic realm="example"');
      res.send('Access denied');
      return;
    }
    res.set('Content-Type', register.contentType);
    res.end(register.metrics());
  });

  // track requests
  app.use(function (req, res, next) {
    var responseTimeInMs = Date.now() - res.locals.startEpoch;
    console.log(req.method, req.path, res.statusCode);
    httpRequestDurationMicroseconds.labels(req.method, req.route.path, res.statusCode).observe(responseTimeInMs);
    next();
  });
}

function pushLoop() {
  var options = {
    auth: PROMETHEUS_PUSH_USERNAME + ':' + PROMETHEUS_PUSH_PASSWORD
  };

  var gateway = new _promClient2.default.Pushgateway(PROMETHEUS_PUSH_URL, options, register);

  var jobName = DYNO;
  var groupings = {};
  if (HEROKU_APP_NAME) {
    jobName = HEROKU_APP_NAME + ' ' + DYNO;
    groupings.heroku_app = HEROKU_APP_NAME;
  }
  if (STAGE) {
    groupings.stage = STAGE;
  }
  if (DYNO) {
    groupings.heroku_dyno_type = DYNO;
  }

  setInterval(function () {
    console.log('pushing');
    gateway.push({ jobName: jobName, groupings: groupings }, function (err) {
      if (err) {
        console.log('Prometheus push error: ' + err);
      }
    });
  }, PROMETHEUS_PUSH_RATE);
}

function initMetrics(app) {
  if (PROMETHEUS_ENABLED) {
    console.log('Prometheus metrics route added (/metrics)');
    registerRoute(app);
  }
  if (PROMETHEUS_PUSH_ENABLED) {
    console.log('Prometheus push enabled');
    pushLoop();
  }
}