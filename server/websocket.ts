// Минимальный WebSocket-сервер (RFC 6455) на встроенных модулях Node — для терминала стенда.
// Поддерживает текстовые и бинарные сообщения, фрагментацию, ping/pong и close. Без расширений.

import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_MESSAGE = 1024 * 1024

export interface WebSocketConnection {
  send(data: string | Buffer): void
  close(code?: number, reason?: string): void
  onMessage(cb: (data: Buffer, isText: boolean) => void): void
  onClose(cb: () => void): void
}

export function acceptKey(key: string): string {
  return createHash('sha1')
    .update(key + GUID)
    .digest('base64')
}

/** Кадр от сервера клиенту (без маски). */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length
  const header = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10)
  header[0] = 0x80 | opcode
  if (len < 126) {
    header[1] = len
  } else if (len < 65536) {
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

export interface Frame {
  fin: boolean
  opcode: number
  payload: Buffer
  /** Сколько байт буфера занял кадр */
  length: number
}

/** Разобрать один кадр из начала буфера или вернуть null, если данных пока не хватает. */
export function decodeFrame(buf: Buffer, requireMask = false): Frame | null {
  if (buf.length < 2) return null
  const fin = (buf[0] & 0x80) !== 0
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  if (buf[0] & 0x70 || ![0, 1, 2, 8, 9, 10].includes(opcode) || (requireMask && !masked))
    throw new Error('Invalid WebSocket frame')
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    const big = buf.readBigUInt64BE(2)
    if (big > BigInt(MAX_MESSAGE)) throw new Error('WebSocket frame too large')
    len = Number(big)
    offset = 10
  }
  if (opcode >= 8 && (!fin || len > 125)) throw new Error('Invalid control frame')
  const maskLen = masked ? 4 : 0
  if (buf.length < offset + maskLen + len) return null
  const payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len))
  if (masked) {
    const mask = buf.subarray(offset, offset + 4)
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
  }
  return { fin, opcode, payload, length: offset + maskLen + len }
}

/** Завершить HTTP upgrade и вернуть соединение. Вызывающий заранее проверяет путь и Origin. */
export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): WebSocketConnection | null {
  const key = req.headers['sec-websocket-key']
  if (
    typeof key !== 'string' ||
    !/^[A-Za-z0-9+/]{22}==$/.test(key) ||
    req.headers['sec-websocket-version'] !== '13' ||
    !(req.headers.connection ?? '')
      .toLowerCase()
      .split(',')
      .map((v) => v.trim())
      .includes('upgrade') ||
    (req.headers.upgrade ?? '').toLowerCase() !== 'websocket'
  ) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    return null
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  )

  const messageHandlers: ((data: Buffer, isText: boolean) => void)[] = []
  const closeHandlers: (() => void)[] = []
  let buffer: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0)
  let fragments: Buffer[] = []
  let fragmentText = false
  let fragmentBytes = 0
  let fragmentCount = 0
  let closed = false

  const finish = () => {
    if (closed) return
    closed = true
    closeHandlers.forEach((cb) => cb())
  }

  const process = () => {
    for (;;) {
      if (closed) return
      let frame: Frame | null
      try {
        frame = decodeFrame(buffer, true)
      } catch {
        socket.destroy()
        return
      }
      if (!frame) return
      buffer = buffer.subarray(frame.length)
      if (frame.opcode === 0x8) {
        if (!closed) socket.end(encodeFrame(0x8, Buffer.alloc(0)))
        finish()
        return
      }
      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(0xa, frame.payload))
        continue
      }
      if (frame.opcode === 0xa) continue
      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        if (fragments.length) {
          socket.destroy()
          return
        }
        fragmentBytes = 0
        fragmentCount = 0
        fragments = [frame.payload]
        fragmentText = frame.opcode === 0x1
      } else if (frame.opcode === 0x0) {
        if (!fragments.length) {
          socket.destroy()
          return
        }
        fragments.push(frame.payload)
      } else {
        continue
      }
      fragmentBytes += frame.payload.length
      fragmentCount++
      if (fragmentBytes > MAX_MESSAGE || fragmentCount > 4096) {
        socket.destroy()
        return
      }
      if (frame.fin) {
        const data = Buffer.concat(fragments)
        fragments = []
        fragmentBytes = 0
        fragmentCount = 0
        messageHandlers.forEach((cb) => cb(data, fragmentText))
      }
    }
  }

  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
    process()
  })
  socket.on('close', finish)
  socket.on('error', finish)
  if (buffer.length) setImmediate(process)

  return {
    send(data) {
      if (closed) return
      if (socket.writableLength > MAX_MESSAGE) { socket.destroy(); return }
      socket.write(
        typeof data === 'string' ? encodeFrame(0x1, Buffer.from(data)) : encodeFrame(0x2, data),
      )
    },
    close(code = 1000, reason = '') {
      if (closed) return
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason))
      payload.writeUInt16BE(code, 0)
      payload.write(reason, 2)
      socket.end(encodeFrame(0x8, payload))
      finish()
    },
    onMessage(cb) {
      messageHandlers.push(cb)
    },
    onClose(cb) {
      closeHandlers.push(cb)
    },
  }
}
