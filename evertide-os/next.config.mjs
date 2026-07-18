/** @type {import('next').NextConfig} */

// Security headers per spec §11.12. CSP allows self plus the Supabase project
// host (REST, Auth, Storage, and Realtime websockets).
const supabaseOrigin = (() => {
  try {
    return new URL((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/^["']|["']$/g, "")).origin;
  } catch {
    return "";
  }
})();
const supabaseWs = supabaseOrigin.replace(/^https/, "wss").replace(/^http:/, "ws:");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // Wildcard *.supabase.co keeps a mis-set env var from bricking auth; the
  // env-derived origin is still listed for self-hosted/custom domains.
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${supabaseOrigin} ${supabaseWs}`.replace(/\s+/g, " ").trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
