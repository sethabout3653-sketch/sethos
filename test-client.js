const http = require('http');
const config = require('./config');

console.log('Testing proxy connection...');

const options = {
  host: 'localhost',
  port: config.port,
  path: 'http://httpbin.org/get',
  headers: {
    'x-proxy-auth': config.secretToken
  }
};

http.get(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log('Response payload received via proxy:');
    console.log(data);
  });
}).on('error', (err) => {
  console.error('Test failed. Error:', err.message);
});
