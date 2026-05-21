/**
 * Fork of node-rtsp-stream/videoStream — uses lib/mpeg1Muxer for RTSP input options.
 */
const ws = require('ws');
const util = require('util');
const events = require('events');
const Mpeg1Muxer = require('./mpeg1Muxer');

const STREAM_MAGIC_BYTES = 'jsmp';

function VideoStream(options) {
  this.options = options;
  this.name = options.name;
  this.streamUrl = options.streamUrl;
  this.width = options.width;
  this.height = options.height;
  this.wsPort = options.wsPort;
  this.inputStreamStarted = false;
  this.stream = undefined;
  this.startMpeg1Stream();
  this.pipeStreamToSocketServer();
}

util.inherits(VideoStream, events.EventEmitter);

VideoStream.prototype.stop = function stop() {
  if (this.wsServer) {
    try {
      this.wsServer.close();
    } catch {
      /* ignore */
    }
  }
  if (this.stream) {
    try {
      this.stream.kill();
    } catch {
      /* ignore */
    }
  }
  this.inputStreamStarted = false;
};

VideoStream.prototype.startMpeg1Stream = function startMpeg1Stream() {
  this.mpeg1Muxer = new Mpeg1Muxer({
    url: this.streamUrl,
    ffmpegPath: this.options.ffmpegPath == null ? 'ffmpeg' : this.options.ffmpegPath,
    ffmpegOptions: this.options.ffmpegOptions,
    inputFfmpegOptions: this.options.inputFfmpegOptions,
  });
  this.stream = this.mpeg1Muxer.stream;
  if (this.inputStreamStarted) return;
  this.mpeg1Muxer.on('mpeg1data', (data) => {
    this.emit('camdata', data);
  });
  this.mpeg1Muxer.on('ffmpegStderr', (data) => {
    if (process.env.STREAM_LOG_FFMPEG === '1') {
      process.stderr.write(data);
    }
  });
  this.mpeg1Muxer.on('exitWithError', () => {
    this.emit('exitWithError');
  });
  this.inputStreamStarted = true;
};

VideoStream.prototype.pipeStreamToSocketServer = function pipeStreamToSocketServer() {
  this.wsServer = new ws.Server({ port: this.wsPort });
  this.wsServer.on('connection', (socket, request) => {
    this.onSocketConnect(socket, request);
  });
  this.wsServer.broadcast = function broadcast(data, opts) {
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data, opts);
      }
    }
  };
  this.on('camdata', (data) => {
    this.wsServer.broadcast(data);
  });
};

VideoStream.prototype.onSocketConnect = function onSocketConnect(socket, request) {
  const streamHeader = Buffer.alloc(8);
  streamHeader.write(STREAM_MAGIC_BYTES);
  streamHeader.writeUInt16BE(this.width || 0, 4);
  streamHeader.writeUInt16BE(this.height || 0, 6);
  socket.send(streamHeader, { binary: true });
  console.log(`${this.name}: New WebSocket Connection (${this.wsServer.clients.size} total)`);
  socket.remoteAddress = request.socket?.remoteAddress;
  socket.on('close', () => {
    console.log(`${this.name}: Disconnected WebSocket (${this.wsServer.clients.size} total)`);
  });
};

module.exports = VideoStream;
