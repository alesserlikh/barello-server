import * as nodemailer from 'nodemailer'

import { env } from '../config/env'

type SendEmailVerificationParams = {
  to: string
  verificationUrl: string
  expiresAt: Date
}

class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailDeliveryError'
  }
}

async function postJsonWithTimeout(
  url: string,
  options: {
    headers: Record<string, string>
    body: unknown
  }
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.emailRequestTimeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new EmailDeliveryError(
        `Email provider returned ${response.status}: ${responseText || response.statusText}`
      )
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function sendViaSmtp(params: SendEmailVerificationParams) {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    throw new EmailDeliveryError(
      'SMTP_HOST, SMTP_USER and SMTP_PASS are required when EMAIL_PROVIDER=smtp'
    )
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
    connectionTimeout: env.emailRequestTimeoutMs,
    greetingTimeout: env.emailRequestTimeoutMs,
    socketTimeout: env.emailRequestTimeoutMs,
  })

  await transporter.sendMail({
    from: env.emailFrom,
    to: params.to,
    subject: 'Подтвердите email в Barello',
    html: buildEmailVerificationHtml(params),
    text: buildEmailVerificationText(params),
  })
}

async function sendViaResend(params: SendEmailVerificationParams) {
  if (!env.resendApiKey) {
    throw new EmailDeliveryError('RESEND_API_KEY is required when EMAIL_PROVIDER=resend')
  }

  await postJsonWithTimeout('https://api.resend.com/emails', {
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
    },
    body: {
      from: env.emailFrom,
      to: params.to,
      subject: 'Подтвердите email в Barello',
      html: buildEmailVerificationHtml(params),
      text: buildEmailVerificationText(params),
    },
  })
}

async function sendViaSendGrid(params: SendEmailVerificationParams) {
  if (!env.sendgridApiKey) {
    throw new EmailDeliveryError('SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid')
  }

  await postJsonWithTimeout('https://api.sendgrid.com/v3/mail/send', {
    headers: {
      Authorization: `Bearer ${env.sendgridApiKey}`,
    },
    body: {
      personalizations: [
        {
          to: [{ email: params.to }],
        },
      ],
      from: parseEmailSender(env.emailFrom),
      subject: 'Подтвердите email в Barello',
      content: [
        {
          type: 'text/plain',
          value: buildEmailVerificationText(params),
        },
        {
          type: 'text/html',
          value: buildEmailVerificationHtml(params),
        },
      ],
    },
  })
}

function parseEmailSender(value: string) {
  const match = value.match(/^(.*)<([^>]+)>$/)

  if (!match) {
    return { email: value.trim() }
  }

  return {
    name: match[1].trim() || undefined,
    email: match[2].trim(),
  }
}

function buildEmailVerificationText(params: SendEmailVerificationParams) {
  return [
    'Подтвердите email в Barello.',
    `Перейдите по ссылке: ${params.verificationUrl}`,
    `Ссылка действует до ${params.expiresAt.toISOString()}.`,
  ].join('\n')
}

function buildEmailVerificationHtml(params: SendEmailVerificationParams) {
  return `
    <p>Подтвердите email в Barello.</p>
    <p><a href="${escapeHtml(params.verificationUrl)}">Подтвердить email</a></p>
    <p>Ссылка действует до ${escapeHtml(params.expiresAt.toISOString())}.</p>
  `
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendEmailVerificationLink(
  params: SendEmailVerificationParams
) {
  if (env.emailProvider === 'smtp') {
    await sendViaSmtp(params)
    return
  }

  if (env.emailProvider === 'resend') {
    await sendViaResend(params)
    return
  }

  if (env.emailProvider === 'sendgrid') {
    await sendViaSendGrid(params)
    return
  }

  console.info('[EmailVerification] Verification link generated', {
    to: params.to,
    verificationUrl: params.verificationUrl,
    expiresAt: params.expiresAt.toISOString(),
  })
}
