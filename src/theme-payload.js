import { THEME_CONTRACT_VERSION } from "./theme-schema.js";
import { replaceAllString } from "./utils.js";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeUtf8(text) {
  const encoded = encodeURIComponent(text);
  const bytes = [];

  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(character.charCodeAt(0));
  }

  return Uint8Array.from(bytes);
}

function decodeUtf8(bytes) {
  let encoded = "";

  for (const byte of bytes) {
    const character = String.fromCharCode(byte);
    if (/^[A-Za-z0-9\-_.!~*'()]$/.test(character)) {
      encoded += character;
      continue;
    }

    encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }

  return decodeURIComponent(encoded);
}

function base64Encode(bytes) {
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triplet = (first << 16) | (second << 8) | third;

    encoded += BASE64_ALPHABET[(triplet >> 18) & 63];
    encoded += BASE64_ALPHABET[(triplet >> 12) & 63];
    encoded += index + 1 < bytes.length ? BASE64_ALPHABET[(triplet >> 6) & 63] : "=";
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[triplet & 63] : "=";
  }

  return encoded;
}

function base64Decode(value) {
  const cleanValue = String(value).replace(/\s+/g, "");
  if (cleanValue.length % 4 !== 0) {
    throw new Error("Invalid base64 input.");
  }

  const bytes = [];

  for (let index = 0; index < cleanValue.length; index += 4) {
    const chars = cleanValue.slice(index, index + 4);
    const values = chars.split("").map((character) => {
      if (character === "=") {
        return 0;
      }

      const nextIndex = BASE64_ALPHABET.indexOf(character);
      if (nextIndex === -1) {
        throw new Error(`Invalid base64 character "${character}".`);
      }
      return nextIndex;
    });

    const triplet = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    bytes.push((triplet >> 16) & 255);
    if (chars[2] !== "=") {
      bytes.push((triplet >> 8) & 255);
    }
    if (chars[3] !== "=") {
      bytes.push(triplet & 255);
    }
  }

  return Uint8Array.from(bytes);
}

function base64UrlEncode(bytes) {
  return replaceAllString(replaceAllString(base64Encode(bytes), "+", "-"), "/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const remainder = value.length % 4;
  const padding = remainder === 0 ? "" : "=".repeat(4 - remainder);
  const padded = replaceAllString(replaceAllString(`${value}${padding}`, "-", "+"), "_", "/");
  return base64Decode(padded);
}

export function buildThemePayload(contract, { source = "figma-plugin", generatedAt = new Date().toISOString() } = {}) {
  return {
    version: THEME_CONTRACT_VERSION,
    themeName: contract.themeName ?? "default",
    contract,
    generatedAt,
    source,
  };
}

export function encodeThemePayload(payload) {
  return base64UrlEncode(encodeUtf8(JSON.stringify(payload)));
}

export function decodeThemePayload(value) {
  const payload = JSON.parse(decodeUtf8(base64UrlDecode(value)));
  if (payload.version !== THEME_CONTRACT_VERSION) {
    throw new Error(`Unsupported theme payload version "${payload.version}". Expected ${THEME_CONTRACT_VERSION}.`);
  }
  return payload;
}
