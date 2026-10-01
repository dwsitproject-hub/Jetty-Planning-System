/**
 * Run: node --test src/lib/smtp-send.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import { smtpGracefulQuit } from './smtp-send.js';
import { sendSmtpMail } from './smtp-send.js';

describe('smtp-send', () => {
  it('sendSmtpMail returns null when SMTP not configured', async () => {
    const prevHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    const result = await sendSmtpMail(undefined, {
      from: 'a@b.com',
      to: 'c@d.com',
      subject: 't',
      text: 'x',
    });
    assert.equal(result, null);
    process.env.SMTP_HOST = prevHost;
  });

  it('smtpGracefulQuit calls quit then resolves on end', async () => {
    const connection = new EventEmitter();
    connection._closing = false;
    let quitCalled = false;
    connection.quit = () => {
      quitCalled = true;
      setImmediate(() => connection.emit('end'));
    };
    connection.close = () => {
      connection._closing = true;
    };
    await smtpGracefulQuit(connection, 1000);
    assert.equal(quitCalled, true);
  });
});
