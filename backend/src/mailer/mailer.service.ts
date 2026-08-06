import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class MailerService {
  private readonly log = new Logger('Mailer')

  readonly configured = Boolean(process.env.MAIL_PROVIDER_URL)

  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.configured) {
      this.log.warn(`No mail provider configured, nothing sent → ${to} · «${subject}»\n${text}`)
      return false
    }
    this.log.log(`✉ → ${to} · «${subject}»\n${text}`)
    return true
  }

  invitationUrl(token: string): string {
    return `${process.env.FRONTEND_ORIGIN}/signup?invite=${token}`
  }

  async sendInvitation(to: string, orgName: string, token: string): Promise<boolean> {
    return this.send(
      to,
      `You're invited to ${orgName} on Nexus`,
      `Accept: ${this.invitationUrl(token)}`,
    )
  }

  async sendPasswordReset(to: string, token: string): Promise<boolean> {
    const url = `${process.env.FRONTEND_ORIGIN}/reset-password?token=${token}`
    return this.send(to, 'Reset your Nexus password', `Reset: ${url} (valid for 1 hour)`)
  }
}
