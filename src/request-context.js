const { AsyncLocalStorage } = require('node:async_hooks');

const requestStorage = new AsyncLocalStorage();

function requestContextMiddleware(request, _response, next) {
  requestStorage.run({ request }, next);
}

function getCurrentUser() {
  return requestStorage.getStore()?.request.currentUser || null;
}

function getCurrentRequest() {
  return requestStorage.getStore()?.request || null;
}

module.exports = { getCurrentRequest, getCurrentUser, requestContextMiddleware };
