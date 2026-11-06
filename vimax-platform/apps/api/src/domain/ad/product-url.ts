// ── Product URL extraction (商品链接 → 广告素材) ─────────────────────
//
// 合规边界（详见 docs/specs/AD-CREATIVE-RESEARCH.md §商品 URL）：
// - 仅在用户主动提交 URL 时抓取单次页面，不做批量爬取
// - 只解析公开的 Open Graph / JSON-LD 元数据，不绕过登录墙或反爬
// - 目标站拒绝（403/超时）即失败，回退为手动填写商品信息
// - SSRF 防护：仅 http(s)，解析 DNS 后拒绝私网/回环/链路本地地址，
//   最多跟 3 次重定向且每跳复检，响应上限 2MB

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ExtractedProduct {
  sourceUrl: string;
  name: string;
  description: string;
  imageUrls: string[];
  brand?: string;
  price?: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

// ── SSRF guards (pure, unit-testable) ───────────────────────────────

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("product_url.invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("product_url.protocol_not_allowed");
  }
  if (url.username || url.password) {
    throw new Error("product_url.credentials_not_allowed");
  }
  // URL.hostname keeps the brackets on IPv6 literals ([::1]) — strip them
  // before the IP checks.
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new Error("product_url.private_address");
  } else if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("product_url.private_address");
  }
  return url;
}

/** Walk every DNS answer; a hostname is only fetchable if ALL resolve public. */
export async function assertResolvablePublicHost(url: URL): Promise<void> {
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("product_url.dns_failure");
  for (const record of records) {
    if (!isPublicIp(record.address)) throw new Error("product_url.private_address");
  }
}

function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  // Malformed input (e.g. the hex tail of an IPv4-mapped IPv6 like
  // "::ffff:a00:1") must fail CLOSED — NaN evades every range check below.
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false; // multicast / reserved
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fe80") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return false; // link-local / unique-local
  }
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped — validate the embedded v4.
    return isPublicIpv4(normalized.slice("::ffff:".length));
  }
  return true;
}

// ── Metadata parsing (pure, unit-testable) ──────────────────────────

function metaContent(html: string, property: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

interface JsonLdProduct {
  "@graph"?: JsonLdProduct[];
  name?: string;
  description?: string;
  brand?: { name?: string } | string;
  image?: string | string[];
  offers?: { price?: string | number; priceCurrency?: string } | Array<{ price?: string | number }>;
}

export function parseProductHtml(html: string, baseUrl: string): ExtractedProduct | null {
  const ogTitle = metaContent(html, "og:title");
  const ogDescription = metaContent(html, "og:description");
  const ogImage = metaContent(html, "og:image");
  const ogSiteName = metaContent(html, "og:site_name");

  // JSON-LD Product schema supplements (never overrides) OG tags.
  let ldName: string | undefined;
  let ldDescription: string | undefined;
  let ldBrand: string | undefined;
  let ldPrice: string | undefined;
  const ldImages: string[] = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: JsonLdProduct | JsonLdProduct[];
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const nodes: JsonLdProduct[] = Array.isArray(data)
      ? data
      : data["@graph"]
        ? [data, ...data["@graph"]]
        : [data];
    for (const node of nodes) {
      const product = node as JsonLdProduct;
      if (typeof product?.name !== "string") continue;
      ldName ??= product.name;
      if (!ldDescription && typeof product.description === "string") {
        ldDescription = product.description;
      }
      if (!ldBrand) {
        ldBrand =
          typeof product.brand === "string"
            ? product.brand
            : typeof product.brand?.name === "string"
              ? product.brand.name
              : undefined;
      }
      const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
      if (!ldPrice && offer?.price != null) {
        ldPrice = String(offer.price);
      }
      const images = Array.isArray(product.image) ? product.image : [product.image];
      for (const image of images) {
        if (typeof image === "string") ldImages.push(image);
      }
    }
  }

  const name = ogTitle ?? ldName;
  if (!name) return null;

  const description = ogDescription ?? ldDescription ?? "";
  const absolute = (candidate: string): string => {
    try {
      return new URL(candidate, baseUrl).toString();
    } catch {
      return candidate;
    }
  };
  const imageUrls = [
    ...(ogImage ? [absolute(ogImage)] : []),
    ...ldImages.map(absolute),
  ].slice(0, 5);

  return {
    sourceUrl: baseUrl,
    name,
    description,
    imageUrls,
    brand: ogSiteName ?? ldBrand,
    price: ldPrice,
  };
}

// ── Fetch orchestration ─────────────────────────────────────────────

export async function extractProductFromUrl(rawUrl: string): Promise<ExtractedProduct> {
  let current = assertPublicHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertResolvablePublicHost(current);

    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ViMaxPlatform/1.0; link-preview)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("product_url.redirect_without_location");
      current = assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      throw new Error(`product_url.fetch_failed_${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      throw new Error("product_url.not_html");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("product_url.empty_response");
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel();
        throw new Error("product_url.too_large");
      }
      chunks.push(value);
    }
    const html = new TextDecoder("utf-8").decode(concatChunks(chunks));
    const product = parseProductHtml(html, current.toString());
    if (!product) throw new Error("product_url.no_product_metadata");
    return product;
  }
  throw new Error("product_url.too_many_redirects");
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
