import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../common/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends transactional mail over SMTP. With no SMTP_URL configured (local dev),
 * messages are printed to the API log so invite/reset links remain usable.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transport: Transporter | null = null;
  /** Last messages, kept in memory only in the test environment for assertions. */
  readonly testOutbox: MailMessage[] = [];

  constructor() {
    if (env().SMTP_URL) this.transport = nodemailer.createTransport(env().SMTP_URL);
  }

  async send(msg: MailMessage) {
    if (env().NODE_ENV === 'test') {
      this.testOutbox.push(msg);
      return;
    }
    if (!this.transport) {
      this.logger.log(`\n──── email (SMTP_URL not set) ────\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n─────────────────────────────────`);
      return;
    }
    try {
      await this.transport.sendMail({ from: env().MAIL_FROM, ...msg });
    } catch (err) {
      this.logger.error(`Failed to send mail to ${msg.to}: ${(err as Error).message}`);
    }
  }
}
