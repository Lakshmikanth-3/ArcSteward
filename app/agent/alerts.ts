// Owner alerts: generic webhook (Discord, Slack, Zapier, ...) and Telegram. Both optional, configured by env.
//   ALERT_WEBHOOK_URL       POST JSON { text, event }
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
import type { ArcEvent } from '../../sdk/src/index';

export function describe(e: ArcEvent) {
  const who = `${e.agent.slice(0, 6)}…${e.agent.slice(-4)}`;
  if (e.type === 'paid') return `Velo402: agent ${who} paid ${e.amount} USDC to ${e.recipient} (tx ${e.hash})`;
  if (e.type === 'gas') return `Velo402: agent ${who} drew ${e.amount} USDC units for gas (tx ${e.hash})`;
  return `Velo402 ALERT: vault blocked agent ${who} paying ${e.amount} USDC to ${e.recipient}: ${e.reason}`;
}

export async function notify(e: ArcEvent) {
  const text = describe(e);
  const jobs: Promise<unknown>[] = [];
  if (process.env.ALERT_WEBHOOK_URL) jobs.push(fetch(process.env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text, event: e }) }));
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) jobs.push(fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }) }));
  const results = await Promise.allSettled(jobs);
  return { text, delivered: results.filter(r => r.status === 'fulfilled').length, channels: jobs.length };
}

/** Plain-text owner alert (used by EarlyPay escalations and rejections). */
export async function notifyText(text: string) {
  const jobs: Promise<unknown>[] = [];
  if (process.env.ALERT_WEBHOOK_URL) jobs.push(fetch(process.env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }) }));
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) jobs.push(fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }) }));
  const results = await Promise.allSettled(jobs);
  return { text, delivered: results.filter(r => r.status === 'fulfilled').length, channels: jobs.length };
}
