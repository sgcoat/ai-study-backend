import nodemailer from 'nodemailer';
import type { Config } from '../../config.js';
import { createCodeEmail, type CodePurpose } from './emailTemplate.js';

export type { CodePurpose } from './emailTemplate.js';
export interface EmailSender {
  sendCode(email: string, code: string, purpose?: CodePurpose): Promise<void>;
  verifyConnection(): Promise<void>;
  close(): void;
}
export function createEmailSender(config: Config): EmailSender {
  if (config.EMAIL_PROVIDER === 'console') return {
    async sendCode(email, code, purpose = 'login') {
      console.log(`[개발용 ${purpose === 'login' ? '로그인' : '계정 삭제'} 인증 코드] ${email}: ${code} (5분 유효)`);
    },
    async verifyConnection() { throw new Error('EMAIL_PROVIDER=smtp로 설정한 뒤 확인하세요.'); },
    close() {},
  };
  const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true', requireTLS: config.SMTP_SECURE !== 'true',
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  return {
    async sendCode(email, code, purpose = 'login') {
      const result = await transport.sendMail({
        from: config.EMAIL_FROM,
        to: email,
        ...createCodeEmail(code, purpose),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      // SMTP acceptance is required; delayed bounces and inbox placement are handled by the mail provider.
      if (!result.accepted?.length || result.rejected?.length) throw new Error('EMAIL_RECIPIENT_REJECTED');
    },
    async verifyConnection() { await transport.verify(); },
    close() { transport.close(); },
  };
}
