// Lead-notification email. Uses SMTP if configured (env), otherwise no-ops
// gracefully so lead capture never fails just because mail isn't set up yet.
import nodemailer from 'nodemailer';

let transporter = null;
function tx() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendLeadNotification(lead) {
  const t = tx();
  const to = process.env.LEAD_NOTIFY_TO || 'hello@sysaiq.com';
  if (!t) { console.log('[lead]', lead.email || '(no email)', '— SMTP not configured, skipping notify'); return; }
  const from = process.env.MAIL_FROM || 'SysaiQ <hello@sysaiq.com>';
  const lines = [
    `New lead #${lead.id}`,
    `Name: ${lead.name || '-'}`,
    `Email: ${lead.email || '-'}`,
    `Phone: ${lead.phone || '-'}`,
    `Company: ${lead.company || '-'}`,
    `Project type: ${lead.project_type || '-'}`,
    `Language: ${lead.language || '-'}  ·  Source: ${lead.source || '-'}`,
    '',
    `Message:\n${lead.message || '-'}`,
    lead.summary ? `\nAI summary:\n${lead.summary}` : '',
  ].join('\n');
  await t.sendMail({ from, to, replyTo: lead.email || undefined, subject: `SysaiQ lead #${lead.id} — ${lead.name || lead.email || 'new'}`, text: lines });
}
