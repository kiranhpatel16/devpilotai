import os
import binascii
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import config as cfg


def _get_key() -> bytes:
    key = binascii.unhexlify(cfg.MASTER_KEY)
    if len(key) != 32:
        raise ValueError(
            "CPWORK_MASTER_KEY must be 32 bytes hex (64 hex chars). "
            "Generate with: openssl rand -hex 32"
        )
    return key


def encrypt_secret(plaintext: str) -> str:
    """Encrypt plaintext. Returns iv:tag:ciphertext (hex)."""
    iv = os.urandom(12)
    aesgcm = AESGCM(_get_key())
    ciphertext_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    # AESGCM.encrypt appends the 16-byte tag at the end
    ciphertext = ciphertext_with_tag[:-16]
    tag = ciphertext_with_tag[-16:]
    return ":".join([iv.hex(), tag.hex(), ciphertext.hex()])


def decrypt_secret(payload: str) -> str | None:
    """Decrypt a value produced by encrypt_secret. Returns None on failure."""
    try:
        parts = payload.split(":")
        if len(parts) != 3:
            return None
        iv_hex, tag_hex, data_hex = parts
        if not iv_hex or not tag_hex or not data_hex:
            return None
        iv = bytes.fromhex(iv_hex)
        tag = bytes.fromhex(tag_hex)
        ciphertext = bytes.fromhex(data_hex)
        aesgcm = AESGCM(_get_key())
        plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
        return plaintext.decode("utf-8")
    except Exception:
        return None
