import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * 계좌번호 등 민감 정보 AES-256-GCM 암호화 (P4-2).
 * 저장 포맷: base64( iv(12) | authTag(16) | ciphertext ).
 * 키: 환경변수 ACCOUNT_ENC_KEY (32바이트 hex[64자] 또는 base64).
 * 주민번호는 저장 자체를 금지 — 이 유틸은 계좌번호 전용.
 */

const IV_LEN = 12
const TAG_LEN = 16

function getKey(): Buffer {
  const raw = process.env.ACCOUNT_ENC_KEY
  if (!raw) throw new Error('ACCOUNT_ENC_KEY 미설정: 계좌 암호화 키가 필요합니다.')
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('ACCOUNT_ENC_KEY 길이 오류: 32바이트(hex 64자 또는 base64)여야 합니다.')
  return key
}

export function encryptAccount(plain: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptAccount(payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const enc = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

/** 마스킹: 뒤 4자리만 노출 (예: ****1234) */
export function maskAccount(last4: string | null): string {
  return last4 ? `****${last4}` : '****'
}
