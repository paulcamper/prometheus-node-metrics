import client from 'prom-client'
import auth from 'basic-auth'

const STAGE = process.env.STAGE || 'dev'
const PROMETHEUS_USERNAME = process.env.PROMETHEUS_USERNAME
const PROMETHEUS_PASSWORD = process.env.PROMETHEUS_PASSWORD
const PROMETHEUS_ENABLED = process.env.PROMETHEUS_ENABLED
const PROMETHEUS_PUSH_ENABLED = process.env.PROMETHEUS_PUSH_ENABLED
const PROMETHEUS_PUSH_USERNAME = process.env.PROMETHEUS_PUSH_USERNAME
const PROMETHEUS_PUSH_PASSWORD = process.env.PROMETHEUS_PUSH_PASSWORD
const PROMETHEUS_PUSH_URL = process.env.PROMETHEUS_PUSH_URL
const PROMETHEUS_PUSH_RATE = process.env.PROMETHEUS_PUSH_RATE || 10000
const DYNO = process.env.DYNO || 'test'
const HEROKU_APP_NAME = process.env.HEROKU_APP_NAME

const { collectDefaultMetrics } = client
const Registry = client.Registry
const register = new Registry()
collectDefaultMetrics({ register })

// Collect requests duration info
const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['route'],
  // buckets for response time from 0.1ms to 500ms
  buckets: [0.10, 5, 15, 50, 100, 200, 300, 400, 500],
})

function registerRoute(app) {
  // Runs before each requests
  app.use((req, res, next) => {
    res.locals.startEpoch = Date.now()
    next()
  })

  app.get('/metrics', (req, res) => {
    const credentials = auth(req)
    if (!credentials || credentials.name !== PROMETHEUS_USERNAME || credentials.pass !== PROMETHEUS_PASSWORD) {
      res.status(401)
      res.header('WWW-Authenticate', 'Basic realm="example"')
      res.send('Access denied')
      return
    }
    res.set('Content-Type', register.contentType)
    res.end(register.metrics())
  })

  // track requests
  app.use((req, res, next) => {
    const responseTimeInMs = Date.now() - res.locals.startEpoch
    httpRequestDurationMicroseconds
      .labels(req.method, req.route.path, res.statusCode)
      .observe(responseTimeInMs)
    next()
  })
}

function pushLoop() {
  const options = {
    auth: `${PROMETHEUS_PUSH_USERNAME}:${PROMETHEUS_PUSH_PASSWORD}`,
  }

  const gateway = new client.Pushgateway(PROMETHEUS_PUSH_URL, options, register)

  let jobName = DYNO
  const groupings = {}
  if (HEROKU_APP_NAME) {
    jobName = `${HEROKU_APP_NAME} ${DYNO}`
    groupings.heroku_app = HEROKU_APP_NAME
  }
  if (STAGE) {
    groupings.stage = STAGE
  }
  if (DYNO) {
    groupings.heroku_dyno_type = DYNO
  }

  setInterval(() => {
    gateway.push({ jobName, groupings }, (err) => {
      if (err) {
        console.log(`Prometheus push error: ${err}`)
      }
    })
  }, PROMETHEUS_PUSH_RATE)
}

export default function initMetrics(app) {
  if (PROMETHEUS_ENABLED) {
    console.log('Prometheus metrics route added (/metrics)')
    registerRoute(app)
  }
  if (PROMETHEUS_PUSH_ENABLED) {
    console.log('Prometheus push enabled')
    pushLoop()
  }
}
