/**
 * SMTP send with post-DATA delay and QUIT (SmarterMail spool-friendly teardown).
 */
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import SMTPConnection from 'nodemailer/lib/smtp-connection/index.js';
import {
  buildSmtpConnectionOptions,
  getEffectiveSmtpConfig,
  isSmtpSendingConfigured,
  smtpPostSendDelay,
} from './smtp-config.js';

const QUIT_WAIT_MS = 5000;

function connectAsync(connection) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      connection.removeListener('error', onError);
      reject(err);
    };
    connection.once('error', onError);
    connection.connect(() => {
      connection.removeListener('error', onError);
      resolve();
    });
  });
}

function loginAsync(connection, auth) {
  return new Promise((resolve, reject) => {
    connection.login(auth, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function sendAsync(connection, envelope, stream) {
  return new Promise((resolve, reject) => {
    connection.send(envelope, stream, (err, info) => {
      if (err) reject(err);
      else resolve(info);
    });
  });
}

/** @param {import('nodemailer/lib/smtp-connection/index.js')} connection */
export async function smtpGracefulQuit(connection, quitWaitMs = QUIT_WAIT_MS) {
  if (!connection || connection._closing) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        connection.close();
      } catch {
        /* ignore */
      }
      finish();
    }, quitWaitMs);
    try {
      timer.unref();
    } catch {
      /* ignore */
    }
    connection.once('end', finish);
    connection.once('error', finish);
    try {
      connection.quit();
    } catch {
      try {
        connection.close();
      } catch {
        /* ignore */
      }
      finish();
    }
  });
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient | undefined} db
 * @param {{ from: string, to: string, subject: string, text?: string, html?: string }} mail
 * @returns {Promise<{ messageId: string, response: string, envelopeTime?: number, messageTime?: number, messageSize?: number } | null>}
 */
export async function sendSmtpMail(db, mail) {
  const cfg = await getEffectiveSmtpConfig(db);
  if (!isSmtpSendingConfigured(cfg)) {
    return null;
  }
  const connectionOptions = buildSmtpConnectionOptions(cfg);
  if (!connectionOptions) {
    return null;
  }

  const composer = new MailComposer({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  const mimeMessage = composer.compile();
  const envelope = mimeMessage.getEnvelope();
  const messageId = mimeMessage.messageId();
  const stream = mimeMessage.createReadStream();

  const connection = new SMTPConnection(connectionOptions);
  try {
    await connectAsync(connection);
    const auth = connectionOptions.auth;
    if (auth?.user && (connection.allowsAuth || connectionOptions.forceAuth)) {
      await loginAsync(connection, auth);
    }
    const info = await sendAsync(connection, envelope, stream);
    await smtpPostSendDelay();
    await smtpGracefulQuit(connection);
    return {
      messageId,
      response: typeof info?.response === 'string' ? info.response : '250 OK',
      envelopeTime: info?.envelopeTime,
      messageTime: info?.messageTime,
      messageSize: info?.messageSize,
    };
  } catch (err) {
    try {
      connection.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
