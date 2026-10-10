/* Backend adapter for the Express server (Railway). */
(function () {
  'use strict';
  const KEY = 'lpAdminToken';
  let token = '';
  try { token = sessionStorage.getItem(KEY) || ''; } catch (e) {}

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.auth && token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401 && opts.auth) { token = ''; try { sessionStorage.removeItem(KEY); } catch (e) {} }
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.details = data && data.details; err.status = res.status;
      throw err;
    }
    return data;
  }

  window.Backend = {
    logo: 'logo.png',
    xlsxUrl: '/vendor/xlsx.full.min.js',
    meta: () => api('/api/meta'),
    quote: (input) => api('/api/quote', { method: 'POST', body: input }),
    isAdmin: () => !!token,
    async login(code) {
      const r = await api('/api/admin/login', { method: 'POST', body: { code: String(code || '') } });
      token = r.token; try { sessionStorage.setItem(KEY, token); } catch (e) {}
    },
    async logout() {
      try { await api('/api/admin/logout', { method: 'POST', auth: true }); } catch (e) {}
      token = ''; try { sessionStorage.removeItem(KEY); } catch (e) {}
    },
    getConfig: () => api('/api/admin/config', { auth: true }),
    async saveConfig(cfg) {
      const r = await api('/api/admin/config', { method: 'PUT', auth: true, body: cfg });
      return { config: r.config, where: 'server' };
    },
    async reset() { return api('/api/admin/reset', { method: 'POST', auth: true }); },
    statusText: () => 'Changes are saved on the server and apply to everyone straight away.',
    download(filename, data) {
      const type = /\.json$/i.test(filename) ? 'application/json' : 'text/csv;charset=utf-8';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type })); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    adminNote: 'The admin code comes from the ADMIN_CODE environment variable (default 8866). On Railway, attach a Volume at /data and set DATA_DIR=/data so edits survive redeploys.',
  };
})();
