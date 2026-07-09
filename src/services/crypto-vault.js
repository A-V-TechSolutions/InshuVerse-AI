// AES-256-GCM crypto vault for Angel.
// Two layers:
//   1. APP layer  – wraps hardcoded vendor keys with a fixed in-source secret.
//                   This is *obfuscation*, not security; it merely keeps raw
//                   API keys from showing up as plaintext strings in the
//                   shipped binary.
//   2. USER layer – wraps user-provided keys at rest in userProfile.json,
//                   bound to the machine via OS-derived material so a stolen
//                   profile JSON cannot be decrypted on a different device.
//
// Output format (all layers): "v1:<base64-iv>:<base64-tag>:<base64-cipher>"

const crypto = require('crypto');
const os = require('os');

const ENC_PREFIX = 'v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

// ── App-layer secret (intentionally split & XORed so a casual grep
//    does not yield a usable hex string) ────────────────────────────────────
const APP_SALT_A = 'a4ngel-vault-salt-v1::';
const APP_SALT_B = 'static-key-derivation-pad';

function _appKey() {
  const mix = Buffer.concat([
    Buffer.from(APP_SALT_A, 'utf8'),
    Buffer.from(APP_SALT_B, 'utf8').reverse(),
  ]);
  return crypto.createHash('sha256').update(mix).digest();
}

// ── User-layer key (machine-bound) ────────────────────────────────────────
function _machineFingerprint() {
  const parts = [
    os.hostname() || '',
    os.platform() || '',
    os.arch() || '',
    os.userInfo().username || '',
  ];
  // Include MAC address of first non-internal interface for stability.
  try {
    const ifs = os.networkInterfaces() || {};
    for (const name of Object.keys(ifs)) {
      for (const a of ifs[name] || []) {
        if (a && a.mac && a.mac !== '00:00:00:00:00:00' && !a.internal) {
          parts.push(a.mac);
          break;
        }
      }
    }
  } catch (_) {}
  return parts.join('|');
}

function _userKey() {
  const fp = _machineFingerprint();
  return crypto.createHash('sha256')
    .update('angel-user-vault-v1::' + fp)
    .digest();
}

function _encWith(key, plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) return '';
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join(':');
}

function _decWith(key, blob) {
  if (typeof blob !== 'string' || !blob.startsWith(ENC_PREFIX)) return '';
  const parts = blob.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return '';
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch (_) {
    return '';
  }
}

// ── Public API ────────────────────────────────────────────────────────────
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

function encryptApp(plaintext) {
  return _encWith(_appKey(), plaintext);
}

function decryptApp(blob) {
  return _decWith(_appKey(), blob);
}

function encryptUser(plaintext) {
  return _encWith(_userKey(), plaintext);
}

function decryptUser(blob) {
  return _decWith(_userKey(), blob);
}

// Tolerant decrypt: accepts both encrypted blob and plaintext (legacy keys).
function decryptAppOrPassthrough(value) {
  if (!value) return '';
  return isEncrypted(value) ? decryptApp(value) : String(value);
}

function decryptUserOrPassthrough(value) {
  if (!value) return '';
  return isEncrypted(value) ? decryptUser(value) : String(value);
}

module.exports = {
  isEncrypted,
  encryptApp,
  decryptApp,
  encryptUser,
  decryptUser,
  decryptAppOrPassthrough,
  decryptUserOrPassthrough,
};

// CLI: `node src/services/crypto-vault.js <plaintext>`  →  encrypted blob
//      Used once to generate ciphertexts to paste into main.js.
if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node crypto-vault.js <plaintext-to-encrypt-with-app-key>');
    process.exit(1);
  }
  console.log(encryptApp(arg));
}
