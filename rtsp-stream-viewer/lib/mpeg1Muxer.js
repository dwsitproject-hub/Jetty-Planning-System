'use strict';
/**
 * Minimal FFmpeg → MPEG1TS spawner.
 * Supports inputFfmpegOptions (flags placed before -i) and ffmpegOptions (flags after -i).
 */
const child_process = require('child_process');
const events = require('events');
const util = require('util');

function Mpeg1Muxer(options) {
  this.url = options.url;
  this.ffmpegPath = options.ffmpegPath || 'ffmpeg';

  const inputFlags = [];
  for (const [k, v] of Object.entries(options.inputFfmpegOptions || {})) {
    inputFlags.push(k);
    if (String(v) !== '') inputFlags.push(String(v));
  }

  const outputFlags = [];
  for (const [k, v] of Object.entries(options.ffmpegOptions || {})) {
    outputFlags.push(k);
    if (String(v) !== '') outputFlags.push(String(v));
  }

  const args = [
    ...inputFlags,
    '-i', this.url,
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    ...outputFlags,
    '-',
  ];

  this.stream = child_process.spawn(this.ffmpegPath, args, { detached: false });

  this.stream.stdout.on('data', (data) => this.emit('mpeg1data', data));
  this.stream.stderr.on('data', (data) => this.emit('ffmpegStderr', data));
  this.stream.on('exit', (code, signal) => {
    if (code === 1) {
      this.emit('exitWithError');
    } else {
      this.emit('exit', code, signal);
    }
  });
}

util.inherits(Mpeg1Muxer, events.EventEmitter);
module.exports = Mpeg1Muxer;
