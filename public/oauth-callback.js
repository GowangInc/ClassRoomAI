history.replaceState(null, '', '/api/provider-oauth/callback');
(async () => {
  let connected = false;
  try {
    const response = await fetch('/api/provider-oauth/finish', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    connected = response.ok;
  } catch { /* The provider page never exposes token-endpoint errors or credentials. */ }
  location.replace(`/?provider_login=${connected ? 'connected' : 'failed'}#/teacher/settings`);
})();
