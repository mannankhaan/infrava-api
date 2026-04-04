import { Resend } from 'resend';
import { env } from '../../config/env';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const FROM_EMAIL = 'Infrava <noreply@infrava.co.in>';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/* ── Base email sender ─────────────────────────────────────── */

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (resend) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
    } catch (err) {
      console.error(`[EMAIL] Failed to send to ${options.to}:`, err);
    }
  } else {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[EMAIL STUB] To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body: ${options.html.replace(/<[^>]+>/g, '')}`);
    console.log(`${'='.repeat(60)}\n`);
  }
}

/* ── Shared HTML wrapper ───────────────────────────────────── */

function emailLayout(body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F1F2F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F2F4;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;border:1px solid #E4E6EA;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background-color:#1C2B41;padding:20px 24px;">
            <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Infrava</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 24px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #E4E6EA;background-color:#F7F8F9;">
            <p style="margin:0;font-size:12px;color:#6B778C;">This is an automated email from Infrava. Please do not reply directly.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#172B4D;">${text}</h2>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#344563;">${text}</p>`;
}

function faultDetailsBlock(params: { faultRef: string; faultTitle: string; faultLocation?: string; priority?: string; plannedCompletion?: string }): string {
  const rows: string[] = [];
  rows.push(`<strong>${params.faultRef}</strong> — ${params.faultTitle}`);
  if (params.faultLocation) rows.push(`Location: ${params.faultLocation}`);
  if (params.priority) rows.push(`Priority: ${params.priority}`);
  if (params.plannedCompletion) rows.push(`Planned Completion: ${params.plannedCompletion}`);

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F8F9;border:1px solid #E4E6EA;border-radius:6px;padding:16px;margin:16px 0;">
      <tr><td>
        ${rows.map(r => `<p style="margin:0 0 6px;font-size:13px;color:#344563;">${r}</p>`).join('')}
      </td></tr>
    </table>`;
}

function primaryButton(label: string, url: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr><td style="background-color:#0C66E4;border-radius:6px;padding:12px 24px;">
        <a href="${url}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">${label}</a>
      </td></tr>
    </table>`;
}

/* ── Email functions ───────────────────────────────────────── */

/** Sent when a NEW operative account is created and assigned a fault */
export async function sendWelcomeAndTaskEmail(params: {
  to: string;
  name: string;
  tempPassword: string;
  faultRef: string;
  faultTitle: string;
  faultLocation: string;
  priority: string;
  plannedCompletion: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: `Welcome to Infrava — You've been assigned ${params.faultRef}`,
    html: emailLayout(`
      ${heading('Welcome to Infrava')}
      ${paragraph(`Hi ${params.name},`)}
      ${paragraph('Your account has been created. Use the credentials below to log in and view your assigned fault.')}
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#E9F2FF;border:1px solid #85B8FF;border-radius:6px;padding:16px;margin:16px 0;">
        <tr><td>
          <p style="margin:0 0 4px;font-size:12px;color:#0055CC;font-weight:600;">YOUR LOGIN DETAILS</p>
          <p style="margin:0 0 4px;font-size:14px;color:#172B4D;"><strong>Email:</strong> ${params.to}</p>
          <p style="margin:0;font-size:14px;color:#172B4D;"><strong>Temporary Password:</strong> <code style="background:#fff;padding:2px 6px;border-radius:3px;font-size:13px;">${params.tempPassword}</code></p>
        </td></tr>
      </table>
      ${paragraph('Please change your password after your first login.')}
      <hr style="border:none;border-top:1px solid #E4E6EA;margin:20px 0;">
      <h3 style="margin:0 0 8px;font-size:16px;color:#172B4D;">Fault Assigned</h3>
      ${faultDetailsBlock(params)}
      ${primaryButton('Open Infrava', env.APP_URL)}
    `),
  });
}

/** Sent when an EXISTING operative is assigned a new fault */
export async function sendTaskNotificationEmail(params: {
  to: string;
  name: string;
  faultRef: string;
  faultTitle: string;
  faultLocation: string;
  priority: string;
  plannedCompletion: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: `New fault assigned — ${params.faultRef}`,
    html: emailLayout(`
      ${heading('New Fault Assigned')}
      ${paragraph(`Hi ${params.name},`)}
      ${paragraph('A new fault has been assigned to you. Log in to view details and start work.')}
      ${faultDetailsBlock(params)}
      ${primaryButton('View Fault', env.APP_URL)}
    `),
  });
}

/** Sent to operative when admin REJECTS their submission */
export async function sendFaultRejectedEmail(params: {
  to: string;
  name: string;
  faultRef: string;
  faultTitle: string;
  rejectionNote: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: `Fault returned — ${params.faultRef} needs revision`,
    html: emailLayout(`
      ${heading('Fault Returned for Revision')}
      ${paragraph(`Hi ${params.name},`)}
      ${paragraph(`Your submission for <strong>${params.faultRef} — ${params.faultTitle}</strong> has been returned by your admin with the following feedback:`)}
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF7F7;border:1px solid #FFBDAD;border-radius:6px;padding:16px;margin:16px 0;border-left:4px solid #DE350B;">
        <tr><td>
          <p style="margin:0;font-size:14px;color:#BF2600;">${params.rejectionNote || 'No additional notes provided.'}</p>
        </td></tr>
      </table>
      ${paragraph('Please review the feedback, make the necessary changes, and resubmit.')}
      ${primaryButton('Open Fault', env.APP_URL)}
    `),
  });
}

/** Sent to admin when operative SUBMITS a fault for review */
export async function sendFaultSubmittedEmail(params: {
  to: string;
  adminName: string;
  operativeName: string;
  faultRef: string;
  faultTitle: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: `Ready for review — ${params.faultRef}`,
    html: emailLayout(`
      ${heading('Fault Ready for Review')}
      ${paragraph(`Hi ${params.adminName},`)}
      ${paragraph(`<strong>${params.operativeName}</strong> has submitted their work for <strong>${params.faultRef} — ${params.faultTitle}</strong>. It's now in your Open Faults queue for review.`)}
      ${primaryButton('Review Fault', env.APP_URL)}
    `),
  });
}

/** Sent to admin when a fault is completed */
export async function sendFaultCompletedEmail(params: {
  to: string;
  name: string;
  faultRef: string;
  faultTitle: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: `Fault completed — ${params.faultRef}`,
    html: emailLayout(`
      ${heading('Fault Completed')}
      ${paragraph(`Hi ${params.name},`)}
      ${paragraph(`The fault <strong>${params.faultRef} — ${params.faultTitle}</strong> has been marked as completed. The PDF report is available for download in your Reports section.`)}
      ${primaryButton('View Reports', `${env.APP_URL}/admin/reports`)}
    `),
  });
}

/** Password reset email */
export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetLink: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: 'Reset your Infrava password',
    html: emailLayout(`
      ${heading('Password Reset')}
      ${paragraph(`Hi ${params.name},`)}
      ${paragraph('We received a request to reset your password. Click the button below to set a new one. This link expires in 1 hour.')}
      ${primaryButton('Reset Password', params.resetLink)}
      ${paragraph('<span style="font-size:12px;color:#6B778C;">If you did not request this, you can safely ignore this email.</span>')}
    `),
  });
}

/** Email verification for new admin accounts */
export async function sendEmailVerification(params: {
  to: string;
  name: string;
  verifyLink: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: 'Verify your Infrava account',
    html: emailLayout(`
      ${heading('Verify Your Email')}
      ${paragraph(`Hi ${params.name},`)}
      ${paragraph('Click the button below to verify your email and activate your account. This link expires in 24 hours.')}
      ${primaryButton('Verify Email', params.verifyLink)}
      ${paragraph('<span style="font-size:12px;color:#6B778C;">If you did not create an account, you can safely ignore this email.</span>')}
    `),
  });
}
