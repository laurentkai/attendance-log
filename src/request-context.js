const { AsyncLocalStorage } = require('node:async_hooks');

const requestStorage = new AsyncLocalStorage();

function requestContextMiddleware(request, _response, next) {
  requestStorage.run({ request }, next);
}

function getCurrentUser() {
  return requestStorage.getStore()?.request.currentUser || null;
}

module.exports = { getCurrentUser, requestContextMiddleware };
