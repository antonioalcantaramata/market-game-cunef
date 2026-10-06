"use client";

// Slides for the projector. PDFs are loaded on the projector computer and kept
// in that browser (IndexedDB): they are never uploaded anywhere, and they are
// still there after a reload. Pages are drawn with pdf.js.

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/api";

export interface Deck {
  name: string;
  data: Blob;
  addedAt: number;
}

// ---------------------------------------------------------------- storage

const DB_NAME = "market-game-slides";
const STORE = "decks";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Decks saved in this browser. Storage can be unavailable (private window): then they live in memory only. */
export function useDecks() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    withStore<Deck[]>("readonly", (s) => s.getAll())
      .then((all) => setDecks(all.sort((a, b) => a.addedAt - b.addedAt)))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const add = async (file: File) => {
    const deck: Deck = { name: file.name, data: file, addedAt: Date.now() };
    try {
      await withStore("readwrite", (s) => s.put(deck));
    } catch {}
    setDecks((ds) => [...ds.filter((d) => d.name !== deck.name), deck]);
    return deck.name;
  };

  const remove = async (name: string) => {
    try {
      await withStore("readwrite", (s) => s.delete(name));
    } catch {}
    setDecks((ds) => ds.filter((d) => d.name !== name));
  };

  return { decks, ready, add, remove };
}

// ---------------------------------------------------------------- pdf

type PdfState = { data?: Blob; doc?: PDFDocumentProxy; error?: string };

/** Opens a PDF with pdf.js. The worker is served from public/ (see scripts/copy-pdf-worker.mjs). */
export function usePdf(data: Blob | undefined) {
  const [state, setState] = useState<PdfState>({});

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs`;
      task = pdfjs.getDocument({ data: new Uint8Array(await data.arrayBuffer()) });
      const doc = await task.promise;
      if (!cancelled) setState({ data, doc });
    })().catch((err) => {
      if (!cancelled) setState({ data, error: err instanceof Error ? err.message : "Could not open this PDF" });
    });
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [data]);

  return state.data === data ? state : {};
}

/**
 * One slide, as large as its container allows, at the screen's pixel density.
 * The neighbouring slides are drawn in advance so the clicker feels instant.
 */
export function SlideCanvas({ doc, page }: { doc: PDFDocumentProxy; page: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<string, Promise<HTMLCanvasElement>>());
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    const draw = (n: number) => {
      const key = `${n}@${size.w}x${size.h}`;
      let job = cache.current.get(key);
      if (!job) {
        job = (async () => {
          const p = await doc.getPage(n);
          const base = p.getViewport({ scale: 1 });
          const viewport = p.getViewport({ scale: Math.min(size.w / base.width, size.h / base.height) * dpr });
          const c = document.createElement("canvas");
          c.width = Math.floor(viewport.width);
          c.height = Math.floor(viewport.height);
          await p.render({ canvas: c, viewport }).promise;
          return c;
        })();
        cache.current.set(key, job);
        // Keep memory bounded: a handful of rendered slides is enough.
        while (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
      }
      return job;
    };

    let alive = true;
    draw(page).then((c) => {
      const out = canvas.current;
      if (!alive || !out) return;
      out.width = c.width;
      out.height = c.height;
      out.style.width = `${c.width / dpr}px`;
      out.style.height = `${c.height / dpr}px`;
      out.getContext("2d")!.drawImage(c, 0, 0);
    });
    if (page < doc.numPages) draw(page + 1);
    if (page > 1) draw(page - 1);
    return () => {
      alive = false;
    };
  }, [doc, page, size]);

  return (
    <div ref={wrap} className="absolute inset-0 flex items-center justify-center bg-black">
      <canvas ref={canvas} />
    </div>
  );
}
