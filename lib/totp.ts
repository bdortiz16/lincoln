import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

export function generateTOTPSecret(): string {
  // Explicitly generate 20 random bytes (standard TOTP secret size)
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

export function getTOTPUri(secret: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: 'CuyPay',
    label: email.replace(/[^a-zA-Z0-9@._-]/g, '_'), // sanitize label
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

export async function getTOTPQRCode(secret: string, email: string): Promise<string> {
  const uri = getTOTPUri(secret, email);
  return QRCode.toDataURL(uri, { width: 200, margin: 2, errorCorrectionLevel: 'M' });
}

export function verifyTOTP(secret: string, token: string): boolean {
  try {
    const totp = new OTPAuth.TOTP({
      issuer: 'CuyPay',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    // window: 1 = accept 1 interval before/after (±30s clock drift)
    const delta = totp.validate({ token: token.replace(/\s/g, ''), window: 2 });
    return delta !== null;
  } catch (e) {
    console.error('[verifyTOTP] error:', e);
    return false;
  }
}
