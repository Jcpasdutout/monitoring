async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`)
    err.status = res.status
    if (res.status === 401) window.dispatchEvent(new Event('monitoring:unauthorized'))
    throw err
  }
  return data
}

export const api = {
  types: () => request('GET', 'api/types'),
  probes: () => request('GET', 'api/probes'),
  create: (p) => request('POST', 'api/probes', p),
  update: (id, p) => request('PUT', `api/probes/${id}`, p),
  remove: (id) => request('DELETE', `api/probes/${id}`),
  run: (id) => request('POST', `api/probes/${id}/run`),
  test: (p) => request('POST', 'api/test', p),
  action: (id, action, params) => request('POST', `api/probes/${id}/action`, { action, params }),
  refresh: () => request('POST', 'api/refresh'),
  auth: () => request('GET', 'api/auth'),
  setup: (login, password) => request('POST', 'api/auth/setup', { login, password }),
  login: (login, password) => request('POST', 'api/auth/login', { login, password }),
  logout: () => request('POST', 'api/auth/logout'),
  changePassword: (current, password) => request('POST', 'api/auth/password', { current, password }),
  tokens: () => request('GET', 'api/tokens'),
  createToken: (name) => request('POST', 'api/tokens', { name }),
  removeToken: (id) => request('DELETE', `api/tokens/${id}`),
}
