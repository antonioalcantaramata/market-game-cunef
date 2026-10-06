"use client";

import QRCode from "qrcode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BASE_PATH } from "@/lib/api";

export function QR({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, color: { dark: "#1a1f6c", light: "#ffffff" } }).then(setSrc);
  }, [text, size]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={`QR code for ${text}`} width={size} height={size} /> : <div style={{ width: size, height: size }} />;
}

/** Absolute URL of a page of this app (origin + base path), available after mount. */
export function useAppUrl(path: string) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  return origin ? `${origin}${BASE_PATH}${path}` : "";
}
