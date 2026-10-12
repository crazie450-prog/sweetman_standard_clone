import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mailChoice } from '../config/integrations'
import type { Role } from '../generated/prisma/client'
import { ROLE_NAMES } from '../common/utils/role-names'
import type { AppConfig } from '../config/env.validation'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const MAIL_TIMEOUT_MS = 10_000

export interface InvitationMail {
  organization: string
  role: Role
  invitedBy: string | null
  expiresAt: Date
}

export function maskedAddress(address: string): string {
  const at = address.lastIndexOf('@')
  if (at < 1) return '***'
  return `${address[0]}***${address.slice(at)}`
}

@Injectable()
export class MailerService {
  private readonly log = new Logger('Mailer')

  constructor(@Inject(ConfigService) private readonly config: AppConfig) {}

  get configured(): boolean {
    return (
      mailChoice(this.config) === 'resend' &&
      Boolean(this.config.get('RESEND_API_KEY', { infer: true }))
    )
  }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    const shown = maskedAddress(to)
    if (!this.configured) {
      this.log.warn(`No mail provider configured, nothing sent to ${shown}`)
      return false
    }

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get('RESEND_API_KEY', { infer: true })}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.get('MAIL_FROM', { infer: true }) ?? 'Nexus <onboarding@resend.dev>',
          to: [to],
          subject,
          text,
        }),
        signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      })
      if (!res.ok) {
        this.log.error(`Mail provider refused the message to ${shown}: HTTP ${res.status}`)
        return false
      }
      this.log.log(`Sent to ${shown}`)
      return true
    } catch (error) {
      this.log.error(`Mail provider unreachable for ${shown}: ${(error as Error).message}`)
      return false
    }
  }

  invitationUrl(token: string): string {
    return `${this.config.getOrThrow('FRONTEND_ORIGIN', { infer: true })}/signup?invite=${token}`
  }

  async sendInvitation(to: string, invite: InvitationMail, token: string): Promise<boolean> {
    const who = invite.invitedBy ? `${invite.invitedBy} has invited you` : 'You have been invited'
    const until = invite.expiresAt.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    return this.send(
      to,
      `You're invited to ${invite.organization} on Nexus`,
      [
        `${who} to join ${invite.organization} on Nexus, the restaurant management platform, as ${ROLE_NAMES[invite.role]}.`,
        '',
        'Accept the invitation and choose your password here:',
        this.invitationUrl(token),
        '',
        `The link works once and expires on ${until}. If you did not expect this invitation, you can ignore this message.`,
      ].join('\n'),
    )
  }

  passwordResetUrl(token: string): string {
    return `${this.config.getOrThrow('FRONTEND_ORIGIN', { infer: true })}/reset-password?token=${token}`
  }

  async sendPasswordReset(to: string, token: string): Promise<boolean> {
    return this.send(
      to,
      'Reset your Nexus password',
      [
        'A password reset was requested for your Nexus account.',
        '',
        'Choose a new password here:',
        this.passwordResetUrl(token),
        '',
        'The link works once and expires in one hour. Using it signs your account out on every device.',
        'If you did not ask for this, ignore this message and your password stays as it is.',
      ].join('\n'),
    )
  }
}
