const koa = require('koa')
const koaRouter = require('koa-router')
const koaBodyParser = require('koa-bodyparser')
const request = require('co-request')
const debug = require('debug')('ilp-plugin-paypal')
const co = require('co')
const EventEmitter = require('eventemitter2')
const uuid = require('uuid4')

module.exports = class PluginPaypal extends EventEmitter {

  constructor ({ host, port, client_id, secret, api }) {
    super()

    this.host = host 
    this.client_id = client_id
    this.secret = secret
    this.port = port
    this.api = api

    this.app = koa()
    this.router = koaRouter()

    this.app
      .use(koaBodyParser())
      .use(this.router.routes())
      .use(this.router.allowedMethods())

    this.connect = co.wrap(this._connect).bind(this)
    this.connected = false
  }

  getBalance () {
    return Promise.resolve('100')
  }

  isConnected () {
    return this.connected
  }

  getInfo () {
    return Promise.resolve({
      precision: 5,
      scale: 2
    })
  }

  getPrefix () {
    return Promise.resolve('paypal.')
  }

  getAccount () {
    return Promise.resolve('paypal.' + this.client_id)
  }

  * _connect () {
    this.connected = true
    const that = this

    this.router.get('/', function * () {
      yield that._getRoot(this)
    })
    this.router.post('/create_payment', function * () {
      yield that._postCreatePayment(this)
    })
    this.router.get('/cancel_payment', function * () {
      yield that._getCancelPayment(this)
    })
    this.router.get('/execute_payment', function * () {
      yield that._getExecutePayment(this)
    })

    this.app.listen(this.port)
    debug('listening on ' + this.port + '...')

    yield this.emitAsync('connect')
  }

  disconnect () {
    this.connected = false
    this.emit('disconnect')
    return Promise.resolve(null)
  }

  * _getToken () {
    if (!this.token) {
      debug('fetching auth token...')
      const res = yield request.post(this.api + '/v1/oauth2/token', {
        method: 'POST',
        accept: 'application/json',
        'accept-language': 'en_US',
        'content-type': 'application/x-www-form-urlencoded',
        auth: {
          user: this.client_id,
          pass: this.secret
        },
        body: 'grant_type=client_credentials'
      })

      const body = JSON.parse(res.body)
      if (body.error) {
        throw new Error(body.error + ': ' + body.error_description)
      }

      this.token = body.access_token
      setTimeout(() => {
        this.token = null
      // expire the token a little before the server does, to be safe
      }, (body.expires_in - 1) * 1000)
      debug('got token', this.token)
    }
    return this.token
  }

  * _postCreatePayment (that) {
    debug('POST /create_payment')
    debug(that.request.body)
    const amount = +that.request.body.amount
    if (isNaN(amount) || amount <= 0) {
      that.status = 400
      that.body = 'Error: Invalid amount "' + amount + '"'
      return
    }

    const token = yield this._getToken()
    console.log('token:', token)
    debug('fetching', this.api + '/v1/payments/payment')
    const res = yield request.post(this.api + '/v1/payments/payment', {
      method: 'POST',
      'accept': '*/*',
      'content-type': 'application/json',
      auth: {
        bearer: token
      },
      headers: {
        'Accept': '*/*',
        'User-Agent': 'curl/7.49.1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'sale',
        redirect_urls: {
          return_url: this.host + '/execute_payment',
          cancel_url: this.host + '/cancel_payment'
        },
        payer: {
          payment_method: 'paypal'
        },
        transactions: [{
          amount: {
            total: amount.toFixed(2),
            currency: 'USD' // TODO: support currencies
          },
          description: 'Memo: ' + that.request.body.memo.replace(/[^A-Za-z0-9 .-_~]/g, '')
        }]
      })
    })

    const body = JSON.parse(res.body)    
    console.log(JSON.stringify(body.links, null, 2))
    for (const link of body.links) {
      if (link.rel === 'approval_url') {
        console.log(link)
        that.redirect(link.href)
        that.status = 301
      }
    }
  }

  * _getCancelPayment (that) {
    that.body = `
<html>
<head>
  <meta charset="utf-8" />
  <title>Plugin Paypal</title>
</head>
<body>
  <div style="margin:auto;width:33em">
    <h1 style="color:red">Cancelled.</h1>
    <p><a href="/">Return home.</a></p>
  </div>
</body>
</html>
`
  }

  * _getExecutePayment (that) {
    debug('GET /execute_payment')

    const token = yield this._getToken()
    console.log(that.query)
    console.log(this.api + '/v1/payments/payment/' + that.query.paymentId + '/execute')
    const res = yield request.post(this.api + '/v1/payments/payment/' + that.query.paymentId + '/execute', {
      method: 'POST',
      'accept': '*/*',
      'content-type': 'application/json',
      auth: {
        bearer: token
      },
      headers: {
        'Accept': '*/*',
        'User-Agent': 'curl/7.49.1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payer_id: that.query.PayerID
      })
    })
    
    const body = JSON.parse(res.body)
    if (!body.state === "approved") {
      return yield this._getCancelPayment(that)
    }

    const amount = body.transactions[0].amount.total
    const memo = body.transactions[0].description.replace(/Memo: /, '')

    this.emitAsync('incoming_transfer', {
      id: uuid(),
      amount: amount,
      account: yield this.getAccount(),
      ledger: yield this.getPrefix(),
      data: {
        memo: memo
      }
    })

    that.body = `
<html>
<head>
  <meta charset="utf-8" />
  <title>Plugin Paypal</title>
</head>
<body>
  <div style="margin:auto;width:33em">
    <h1 style="color:green">Success!</h1>
    <p>Sent ${amount} USD with memo "${memo}"</p>
    <p><a href="/">Return home.</a></p>
  </div>
</body>
</html>
`
  }

  * _getRoot (that) {
    debug('GET /')
    // TODO: support currencies
    that.body = `
<html>
<head>
  <meta charset="utf-8" />
  <title>Plugin Paypal</title>
</head>
<body>
  <div style="margin:auto;width:33em;">
    <h1>Paypal Settlement</h1>
    <hr />
    <form action="/create_payment" method="post">
      <label>Amount ($) <input type="number" value="1" name="amount" /></label>
      <br />
      <label>Memo       <input type="text" placeholder="text here" name="memo" /></label>
      <br />
      <input type="submit" />
    </form>
  </div>
</body>
</html>
`
  }
}
