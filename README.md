# ILP-Plugin-Paypal

> ILP settlement over Paypal

## Usage

You need to have Paypal REST API credentials in order to use `ilp-plugin-paypal`.
Below are the parameters to the constructor:

```js
{
  port: '8080',
  // 'host' is the public way to access the above port.
  // In this example, we assume localhost:8080 is proxied to
  // 'https://wallet1.com/paypal/'
  host: 'https://wallet1.com/paypal/',
  client_id: '<PAYPAL CLIENT ID>',
  secret: '<PAYPAL SECRET>',
  // use 'https://api.sandbox.paypal.com' for test transactions
  api: 'https://api.paypal.com'
}
```
