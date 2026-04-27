// _worker.js — Cloudflare Pages Worker
// ============================================================
// Pengganti proxy.js (Netlify) untuk Cloudflare Pages.
//
// Cara kerja IDENTIK dengan proxy.js:
//   Browser → POST /api/proxy → Worker → POST GAS URL
//
// Perbedaan dari Netlify Function:
//   - Syntax: Request/Response Web API (bukan event.httpMethod)
//   - Environment variable diakses via env.GAS_WEB_APP_URL
//   - File ini diletakkan di ROOT folder (sejajar index.html)
//   - Cloudflare otomatis mendeteksi _worker.js
//
// Free tier Cloudflare: 100.000 request/HARI (jauh > Netlify)
// ============================================================

const ALLOWED_ACTIONS = [
  'login',
  'absenMasuk',
  'absenPulang',
  'getStatusAbsensiHariIni',
  'getInfoShiftHariIni',
  'changePassword',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Hanya tangani path /api/proxy — request lain diteruskan ke Pages (index.html dll)
    if (url.pathname !== '/api/proxy') {
      return env.ASSETS.fetch(request);
    }

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Hanya terima POST
    if (request.method !== 'POST') {
      return jsonResponse({ success: false, message: 'Method not allowed.' }, 405);
    }

    // Validasi env variable
    const GAS_URL = env.GAS_WEB_APP_URL || '';
    if (!GAS_URL) {
      return jsonResponse({
        success: false,
        message: 'GAS_WEB_APP_URL belum diset. Tambahkan di Cloudflare Pages → Settings → Environment Variables.',
      }, 500);
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ success: false, message: 'Body bukan JSON valid.' }, 400);
    }

    const { action, payload } = body;

    // Validasi action whitelist
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return jsonResponse({ success: false, message: `Action "${action}" tidak diizinkan.` }, 403);
    }

    // ── Forward ke GAS ──────────────────────────────────────
    // Kirim action via query string DAN body (workaround GAS postData parsing)
    const gasUrl  = GAS_URL + '?action=' + encodeURIComponent(action);
    const gasBody = JSON.stringify({ action, payload: payload || {} });

    console.log('[worker] -> GAS action:', action);

    try {
      const gasRes  = await fetch(gasUrl, {
        method:   'POST',
        headers:  { 'Content-Type': 'text/plain' },
        body:     gasBody,
        redirect: 'follow',
      });

      const gasText = await gasRes.text();
      console.log('[worker] <- GAS status:', gasRes.status, '| preview:', gasText.substring(0, 200));

      // Parse JSON dari GAS
      let gasResult;
      try {
        gasResult = JSON.parse(gasText);
      } catch (parseErr) {
        console.error('[worker] GAS bukan JSON:', gasText.substring(0, 500));

        const hint = gasText.includes('Sign in')
          ? 'Web App GAS meminta login Google. Deploy ulang dengan akses "Anyone".'
          : gasText.includes('Error')
            ? 'GAS script error. Cek Execution Log di Apps Script Editor.'
            : 'GAS tidak mengembalikan JSON. Pastikan sudah di-deploy ulang setelah edit kode.';

        return jsonResponse({ success: false, message: hint }, 502);
      }

      return jsonResponse(gasResult, 200);

    } catch (fetchErr) {
      console.error('[worker] fetch error:', fetchErr.message);
      return jsonResponse({
        success: false,
        message: 'Gagal terhubung ke GAS: ' + fetchErr.message,
      }, 502);
    }
  },
};
