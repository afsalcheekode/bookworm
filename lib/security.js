import { URL } from 'node:url';

// In-memory rate limiting stores
const authLimiterMap = new Map();
const generalLimiterMap = new Map();

// Periodic cleanup of rate limiter memory every 10 minutes
setInterval(() => {
  const now = Date.now();
  cleanLimiterStore(authLimiterMap, now);
  cleanLimiterStore(generalLimiterMap, now);
}, 10 * 60 * 1000).unref();

function cleanLimiterStore(map, now) {
  for (const [key, record] of map.entries()) {
    if (now > record.resetTime) {
      map.delete(key);
    }
  }
}

/**
 * Check and record request rate
 */
export function checkRateLimit(ip, type = 'general') {
  const isAuth = type === 'auth';
  const map = isAuth ? authLimiterMap : generalLimiterMap;
  const maxRequests = isAuth ? 12 : 180; // 12 auth attempts per 15m; 180 general reqs per 1m
  const windowMs = isAuth ? 15 * 60 * 1000 : 60 * 1000;

  const now = Date.now();
  let record = map.get(ip);

  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    map.set(ip, record);
    return { allowed: true, remaining: maxRequests - 1 };
  }

  record.count += 1;
  if (record.count > maxRequests) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, retryAfter: retryAfterSeconds };
  }

  return { allowed: true, remaining: maxRequests - record.count };
}

/**
 * Apply hardened HTTP Security Headers
 */
export function applySecurityHeaders(res) {
  // Content Security Policy allowing Tailwind CDN, FontAwesome, Google Fonts, and Unsplash
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
    "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://images.unsplash.com https://books.google.com http://books.google.com https://covers.openlibrary.org https://images-na.ssl-images-amazon.com",
    "connect-src 'self' https://openlibrary.org https://www.googleapis.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Modern browsers prefer CSP over buggy legacy auditor
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}

/**
 * HTML entities escaping to defeat Stored & Reflected XSS
 */
export function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * SSRF and Malicious URL protection
 * Rejects javascript:, data:, file:, and private IP ranges
 */
export function isSafeUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  const trimmed = urlString.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and loopback
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    // Block AWS / GCP / Azure metadata endpoint
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
      return false;
    }

    // Block Private IPv4 ranges (RFC 1918)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    if (match) {
      const octet1 = parseInt(match[1], 10);
      const octet2 = parseInt(match[2], 10);

      // 10.0.0.0/8
      if (octet1 === 10) return false;
      // 172.16.0.0/12
      if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return false;
      // 192.168.0.0/16
      if (octet1 === 192 && octet2 === 168) return false;
      // 0.0.0.0
      if (octet1 === 0) return false;
    }

    return true;
  } catch {
    return false;
  }
}
