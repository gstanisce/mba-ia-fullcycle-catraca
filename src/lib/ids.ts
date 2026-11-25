import { randomBytes } from 'node:crypto';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
/** Ticket code alphabet: no 0/O or 1/I, to avoid confusion at the door. */
export const TICKET_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Uniformly random string over `alphabet` (rejection sampling, no modulo bias). */
function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** `prefix_` + 10 chars `[0-9a-z]`, e.g. `usr_k3j9x0a1bz`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomString(BASE36, 10)}`;
}

/** 8-char ticket code over TICKET_CODE_ALPHABET. */
export function newTicketCode(): string {
  return randomString(TICKET_CODE_ALPHABET, 8);
}
