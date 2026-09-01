// ============================================================
// PATIENT ZERO - Solana Address Validation
// ============================================================

// Base58 alphabet: 1-9, A-H, J-N, P-Z, a-k, m-z
// Explicitly excludes: 0 (zero), O (capital o), I (capital i), l (lowercase L)
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateSolanaAddress(address: string): ValidationResult {
  if (!address || address.trim() === '') {
    return { valid: false, error: 'Address is required' };
  }

  const trimmed = address.trim();

  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return {
      valid: false,
      error: 'Ethereum address detected (0x...). Enter a Solana address instead.'
    };
  }

  if (trimmed.length < 32) {
    return {
      valid: false,
      error: `Address too short (${trimmed.length} chars). Solana addresses are 32–44 characters.`
    };
  }

  if (trimmed.length > 44) {
    return {
      valid: false,
      error: `Address too long (${trimmed.length} chars). Solana addresses are 32–44 characters.`
    };
  }

  if (!BASE58_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'Invalid characters. Solana addresses use base58 (no 0, O, I, or l).'
    };
  }

  return { valid: true };
}
