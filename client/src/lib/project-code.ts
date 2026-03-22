const PROJECT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROJECT_CODE_LENGTH = 24;

export function sanitizeProjectCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PROJECT_CODE_LENGTH);
}

export function generateProjectCode(length = PROJECT_CODE_LENGTH) {
  const chars = new Uint32Array(length);
  crypto.getRandomValues(chars);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += PROJECT_CODE_ALPHABET[chars[i] % PROJECT_CODE_ALPHABET.length];
  }
  return code;
}
