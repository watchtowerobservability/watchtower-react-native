'use strict';
// User feedback (ERR-014), posted from JS to the edge (`POST /v1/rum/feedback`) also when the native SDK is on.

const MAX_MESSAGE = 4096;

/** The request body, like the browser SDK's `feedbackBody`; `null` when there is nothing to send. */
function feedbackBody(f, lastError) {
  const message = String((f && f.message) ?? '').trim().slice(0, MAX_MESSAGE);
  if (!message) return null;
  const body = { message };
  const id = String(f.eventId ?? lastError ?? '').replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(id)) body.event_id = id.toLowerCase();
  const name = String(f.name ?? '').trim();
  const email = String(f.email ?? '').trim();
  if (name) body.name = name.slice(0, 256);
  if (email) body.email = email.slice(0, 256);
  return body;
}

/** Send feedback; resolves false when it was not accepted (never throws). */
async function sendFeedback(c, f) {
  const body = feedbackBody(f, c.lastErrorId);
  if (!body || !c.fetch) return false;
  try {
    const res = await c.fetch(`${c.cfg.endpoint}/v1/rum/feedback`, {
      method: 'POST', headers: c.headers(),
      body: JSON.stringify(body),
    });
    return !!res.ok;
  } catch (_) {
    return false;
  }
}

module.exports = { feedbackBody, sendFeedback };
