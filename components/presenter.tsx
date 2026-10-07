"use client";

// Projector presenter: switches between the live game, the summary of the
// parts played so far, the statistical analysis (collusion detection) and a PDF deck on the
// same full screen. The game stays mounted (hidden) while slides are shown,
// so it keeps updating and comes back exactly where it is. The view, the deck
// and the slide of each deck are remembered in this browser.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SlideCanvas, useDecks, usePdf } from "./slides";

type View = "game" | "summary" | "analysis" | "slides";

const KEY = "market-game:projector:";

function load<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(KEY + name);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(name: string, value: unknown) {
  try {
    localStorage.setItem(KEY + name, JSON.stringify(value));
  } catch {}
}

// Presentation clickers send PageDown/PageUp (or arrows); their "blank screen"
// button sends B or ".", which we use as the slides ⇄ game switch.
const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const PREV = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);
const SWITCH = new Set(["g", "G", "b", "B", "."]);
const SUMMARY = new Set(["s", "S"]);
const ANALYSIS = new Set(["a", "A"]); // statistical analysis; its own steps use the clicker (see components/part3.tsx)

export function Presenter({
  children,
  summary,
  analysis,
}: {
  children: ReactNode;
  summary?: ReactNode;
  analysis?: ReactNode;
}) {
  const { decks, ready, add, remove } = useDecks();
  const [view, setView] = useState<View>(() => load<View>("view", "game"));
  const [deckName, setDeckName] = useState<string | null>(() => load<string | null>("deck", null));
  const [pages, setPages] = useState<Record<string, number>>(() => load("pages", {}));
  const [active, setActive] = useState(true); // mouse moved recently → show the controls
  const fileInput = useRef<HTMLInputElement>(null);

  const deck = decks.find((d) => d.name === deckName) ?? decks.at(-1);
  const { doc, error } = usePdf(deck?.data);
  const total = doc?.numPages ?? 0;
  const page = deck ? Math.min(Math.max(1, pages[deck.name] ?? 1), Math.max(1, total)) : 1;

  const switchTo = (v: View) => {
    setView(v);
    save("view", v);
  };
  const chooseDeck = (name: string) => {
    setDeckName(name);
    save("deck", name);
  };
  const goTo = (n: number) => {
    if (!deck || !total) return;
    const p = Math.min(Math.max(1, n), total);
    setPages((ps) => {
      const next = { ...ps, [deck.name]: p };
      save("pages", next);
      return next;
    });
  };
  const loadFile = async (file: File | undefined) => {
    if (!file || !/\.pdf$/i.test(file.name)) return;
    chooseDeck(await add(file));
    switchTo("slides");
  };

  // Keyboard and clicker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (SWITCH.has(e.key)) {
        e.preventDefault();
        switchTo(view === "slides" ? "game" : "slides");
      } else if (summary && SUMMARY.has(e.key)) {
        e.preventDefault();
        switchTo(view === "summary" ? "game" : "summary");
      } else if (analysis && ANALYSIS.has(e.key)) {
        e.preventDefault();
        switchTo(view === "analysis" ? "game" : "analysis");
      } else if (view === "slides" && NEXT.has(e.key)) {
        e.preventDefault();
        goTo(page + 1);
      } else if (view === "slides" && PREV.has(e.key)) {
        e.preventDefault();
        goTo(page - 1);
      } else if (view === "slides" && e.key === "Home") {
        goTo(1);
      } else if (view === "slides" && e.key === "End") {
        goTo(total);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Controls and cursor appear when the mouse moves and hide after 3 s.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setActive(false), 3000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
    };
  }, []);

  // Drop a PDF anywhere on the screen to load it.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      loadFile(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  const showControls = active || (view === "slides" && !doc);
  // The view is remembered in this browser; render only once on the client so
  // the first paint does not disagree with the server-rendered HTML.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!hydrated) return null;

  return (
    <div className={showControls ? "" : "cursor-none"}>
      <div className={view === "game" ? "" : "hidden"}>{children}</div>
      {view === "summary" && summary}
      {view === "analysis" && analysis}

      {view === "slides" &&
        (doc ? (
          <SlideCanvas doc={doc} page={page} />
        ) : (
          <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black text-center text-white">
            {error ? (
              <p className="text-xl text-orange">Could not open “{deck?.name}”: {error}</p>
            ) : deck ? (
              <p className="text-xl opacity-70">Loading slides…</p>
            ) : ready ? (
              <>
                <p className="text-3xl font-bold">No slides yet</p>
                <p className="text-lg opacity-70">Drop a PDF here, or use “Load PDF” in the corner.</p>
                <p className="text-sm opacity-50">It stays on this computer: nothing is uploaded.</p>
              </>
            ) : null}
          </div>
        ))}

      <div
        className={`fixed right-4 bottom-4 z-50 flex items-center gap-1 rounded-xl bg-black/75 p-1.5 text-sm text-white shadow-lg transition-opacity ${
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="flex rounded-lg bg-white/10 p-0.5" title="G: game ⇄ slides (or the clicker's blank-screen button) · S: summary · A: statistical analysis">
          {(["game", ...(summary ? ["summary"] : []), ...(analysis ? ["analysis"] : []), "slides"] as View[]).map((v) => (
            <button
              key={v}
              className={`rounded-md px-3 py-1.5 font-semibold ${view === v ? "bg-white text-navy" : "text-white/80 hover:text-white"}`}
              onClick={() => switchTo(v)}
            >
              {{ game: "Game", summary: "Summary", analysis: "Analysis", slides: "Slides" }[v]}
            </button>
          ))}
        </div>
        {view === "slides" && total > 0 && (
          <>
            <button className="rounded-md px-2.5 py-1.5 hover:bg-white/15" onClick={() => goTo(page - 1)} aria-label="Previous slide">
              ◀
            </button>
            <span className="tabular min-w-14 text-center">
              {page} / {total}
            </span>
            <button className="rounded-md px-2.5 py-1.5 hover:bg-white/15" onClick={() => goTo(page + 1)} aria-label="Next slide">
              ▶
            </button>
          </>
        )}
        {decks.length > 1 && (
          <select
            className="max-w-48 rounded-md bg-white/10 px-2 py-1.5"
            value={deck?.name}
            onChange={(e) => chooseDeck(e.target.value)}
            title="Deck"
          >
            {decks.map((d) => (
              <option key={d.name} value={d.name} className="text-ink">
                {d.name.replace(/\.pdf$/i, "")}
              </option>
            ))}
          </select>
        )}
        <button className="rounded-md px-2.5 py-1.5 hover:bg-white/15" onClick={() => fileInput.current?.click()}>
          Load PDF
        </button>
        {deck && view === "slides" && (
          <button
            className="rounded-md px-2.5 py-1.5 text-white/70 hover:bg-white/15 hover:text-white"
            onClick={() => confirm(`Remove “${deck.name}” from this computer?`) && remove(deck.name)}
            title="Remove this deck from this computer"
          >
            ✕
          </button>
        )}
        <button
          className="rounded-md px-2.5 py-1.5 hover:bg-white/15"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
          title="Full screen"
        >
          ⛶
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            loadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
