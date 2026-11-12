import { describe, expect, it } from 'vitest'
import { Duplex } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { acceptWebSocket, decodeFrame, encodeFrame } from './websocket.ts'
class Socket extends Duplex {
  writes: Buffer[] = []
  _read() {}
  _write(data: Buffer, _encoding: BufferEncoding, done: () => void) {
    this.writes.push(Buffer.from(data))
    done()
  }
}
const req = (headers: IncomingMessage['headers'] = {}) =>
  ({
    headers: {
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
      upgrade: 'websocket',
      connection: 'Upgrade',
      ...headers,
    },
  }) as IncomingMessage
function client(opcode: number, text: string, fin = true) {
  const payload = Buffer.from(text),
    mask = Buffer.from([1, 2, 3, 4])
  return Buffer.concat([
    Buffer.from([(fin ? 128 : 0) | opcode, 128 | payload.length]),
    mask,
    Buffer.from(payload.map((b, i) => b ^ mask[i % 4])),
  ])
}
describe('review: WebSocket protocol guards', () => {
  it('requires version, connection upgrade and a real 16-byte base64 key', () => {
    for (const headers of [
      { 'sec-websocket-version': '12' },
      { connection: 'keep-alive' },
      { 'sec-websocket-key': 'fake' },
    ]) {
      const s = new Socket()
      expect(acceptWebSocket(req(headers), s, Buffer.alloc(0))).toBeNull()
      expect(s.writes[0].toString()).toContain('400 Bad Request')
    }
  })
  it('rejects unmasked, reserved and fragmented/oversized control frames', () => {
    expect(() => decodeFrame(encodeFrame(1, Buffer.from('x')), true)).toThrow()
    for (const f of [
      client(3, 'x'),
      client(9, 'x', false),
      Buffer.from([0xc1, 128, 1, 2, 3, 4]),
      Buffer.from([0x89, 126, 0, 126]),
    ])
      expect(() => decodeFrame(f, true)).toThrow()
  })
  it('preserves valid fragmented input and ping, but rejects orphan continuation', () => {
    const s = new Socket(),
      ws = acceptWebSocket(req(), s, Buffer.alloc(0))!,
      received: string[] = []
    ws.onMessage((b) => received.push(b.toString()))
    s.emit('data', client(1, 'ab', false))
    s.emit('data', client(9, 'ping'))
    s.emit('data', client(0, 'cd'))
    expect(received).toEqual(['abcd'])
    expect(decodeFrame(s.writes[1])?.opcode).toBe(10)
    s.emit('data', client(0, 'orphan'))
    expect(s.destroyed).toBe(true)
    expect(received).toEqual(['abcd'])
  })
})
