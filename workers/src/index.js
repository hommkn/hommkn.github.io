/**
 * BeadSnap Creem payment helper.
 *
 * Routes:
 * - POST /checkout creates a Creem checkout session with the correct success URL.
 * - POST /webhook receives Creem payment events.
 * - POST / also accepts webhooks for simple dashboard configuration.
 */
const DEFAULT_PRODUCT_ID = 'prod_1zRfEdOoyK8jGsPFKhXEM2';
const DEFAULT_SUCCESS_URL = 'https://beadsnap.app/pro-pattern.html?purchase=success';
const ALLOWED_ORIGINS = new Set([
  'https://beadsnap.app',
  'https://www.beadsnap.app',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://beadsnap.app';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(request ? corsHeaders(request) : {})
    }
  });
}

async function verifySignature(body, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const computedSig = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return computedSig === signature;
}

async function createCheckout(request, env) {
  if (!env.CREEM_API_KEY) {
    return json({ error: 'CREEM_API_KEY is not configured' }, 500, request);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const productId = env.CREEM_PRODUCT_ID || DEFAULT_PRODUCT_ID;
  const successUrl = env.CREEM_SUCCESS_URL || DEFAULT_SUCCESS_URL;
  const apiBase = env.CREEM_TEST_MODE === 'true'
    ? 'https://test-api.creem.io'
    : 'https://api.creem.io';

  const checkoutResponse = await fetch(`${apiBase}/v1/checkouts`, {
    method: 'POST',
    headers: {
      'x-api-key': env.CREEM_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      product_id: productId,
      request_id: payload.request_id || `beadsnap-${Date.now()}`,
      success_url: successUrl,
      metadata: {
        source: payload.source || 'beadsnap-site',
        product: 'pro-pattern'
      }
    })
  });

  const data = await checkoutResponse.json().catch(() => ({}));
  if (!checkoutResponse.ok) {
    console.error('Creem checkout failed', checkoutResponse.status, JSON.stringify(data));
    return json({ error: 'Could not create checkout', details: data }, 502, request);
  }

  const url = data.checkout_url || data.checkoutUrl || data.url;
  if (!url) {
    return json({ error: 'Creem response did not include a checkout URL', details: data }, 502, request);
  }

  return json({ url, checkout_id: data.id || null }, 200, request);
}

async function handleWebhook(request, env) {
  const body = await request.text();
  const signature = request.headers.get('creem-signature');

  if (!signature || !env.CREEM_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const valid = await verifySignature(body, signature, env.CREEM_WEBHOOK_SECRET);
  if (!valid) {
    return new Response('Invalid signature', { status: 403 });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = event.eventType || event.type || 'unknown';
  const checkout = event.object || event.data || {};
  console.log(`[Creem] ${eventType}`, JSON.stringify(event));

  if (eventType === 'checkout.completed' && env.NOTIFY_EMAIL) {
    try {
      await sendNotification(env, env.NOTIFY_EMAIL, checkout);
    } catch (err) {
      console.error('Email notification failed:', err);
    }
  }

  return new Response('OK', { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'beadsnap-payments' }, 200, request);
    }

    if (request.method === 'POST' && url.pathname === '/checkout') {
      return createCheckout(request, env);
    }

    if (request.method === 'POST' && (url.pathname === '/webhook' || url.pathname === '/')) {
      return handleWebhook(request, env);
    }

    return json({ error: 'Not found' }, 404, request);
  }
};

async function sendNotification(env, toEmail, checkout) {
  const customerEmail = checkout.customer?.email || checkout.customer_email || 'unknown';
  const order = checkout.order || {};
  const amountCents = order.amount || checkout.amount || checkout.product?.price;
  const currency = order.currency || checkout.product?.currency || 'USD';
  const amount = amountCents ? `${currency} ${(amountCents / 100).toFixed(2)}` : 'unknown';

  const html = [
    '<h2>New BeadSnap Pro Pattern Purchase</h2>',
    '<table>',
    `<tr><td><strong>Customer:</strong></td><td>${customerEmail}</td></tr>`,
    `<tr><td><strong>Amount:</strong></td><td>${amount}</td></tr>`,
    `<tr><td><strong>Checkout ID:</strong></td><td>${checkout.id || 'N/A'}</td></tr>`,
    `<tr><td><strong>Order ID:</strong></td><td>${order.id || 'N/A'}</td></tr>`,
    `<tr><td><strong>Product:</strong></td><td>Pro Pattern ($5 one-time)</td></tr>`,
    '</table>',
    '<p>View all payments in <a href="https://www.creem.io/dashboard">Creem Dashboard</a>.</p>'
  ].join('');

  if (env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || 'BeadSnap <noreply@beadsnap.app>',
        to: [toEmail],
        subject: `New BeadSnap Pro Pattern sale - ${amount}`,
        html
      })
    });
  } else {
    console.log('Email notification:', { to: toEmail, subject: `New BeadSnap Pro Pattern sale - ${amount}` });
  }
}
