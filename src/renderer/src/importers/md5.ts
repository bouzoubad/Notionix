/**
 * MD5 of bytes, as hex. Evernote names the images of a note by the MD5 of
 * their data; Web Crypto has no MD5. Not used for any security purpose.
 */
export function md5Hex(bytes: Uint8Array): string {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
  const length = bytes.length
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64)
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (length * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(chunk + i * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const s = S[(i >> 4) * 4 + (i % 4)]
      const sum = (a + f + K[i] + M[g]) >>> 0
      a = d
      d = c
      c = b
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  return [a0, b0, c0, d0]
    .map((w) =>
      [0, 8, 16, 24].map((shift) => ((w >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')
    )
    .join('')
}
