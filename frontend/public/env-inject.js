// This script injects the BACKEND_URL from the environment into the global window object at runtime.
(function() {
  var backendUrl = (function() {
    // Try to read from injected environment variable (nginx or Docker)
    return (window.BACKEND_URL_ENV || process.env.BACKEND_URL || null);
  })();
  if (backendUrl) {
    window.BACKEND_URL = backendUrl;
  }
})();

