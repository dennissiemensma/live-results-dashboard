// This script injects the BACKEND_URL from the environment into the global window object at runtime.
(function() {
  var backendUrl = window.BACKEND_URL_ENV || null;
  if (backendUrl) {
    window.BACKEND_URL = backendUrl;
  }
})();
