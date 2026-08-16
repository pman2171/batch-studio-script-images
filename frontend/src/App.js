import "@/App.css";
import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  DownloadSimple,
  ArrowClockwise,
  Warning,
  CircleNotch,
  Lightning,
  Stack,
  ImageSquare,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Toaster, toast } from "@/components/ui/sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SAMPLE = `1. A lone astronaut standing on a red desert planet at sunset, cinematic wide shot
2. Neon-lit cyberpunk alley in the rain, reflections on wet pavement
3. A cozy wooden cabin in a snowy pine forest, warm glowing windows at night`;

function parsePrompts(text) {
  const lines = text.split("\n");
  const items = [];
  const re = /^\s*(\d+)[.):\]-]?\s*(.+)$/;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(re);
    const prompt = m ? m[2].trim() : trimmed;
    if (prompt) items.push({ prompt });
  }
  return items;
}

function pad(n, width) {
  return String(n).padStart(width, "0");
}

export default function App() {
  const [script, setScript] = useState("");
  const [items, setItems] = useState([]); // {index, prompt, status, image}
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [keyMissing, setKeyMissing] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    axios
      .get(`${API}/config`)
      .then((r) => setKeyMissing(!r.data.api_key_configured))
      .catch(() => {});
  }, []);

  const padWidth = Math.max(2, String(items.length || 0).length);

  const generateOne = useCallback(async (prompt) => {
    const { data } = await axios.post(`${API}/jobs`, { prompt });
    const jobId = data.job_id;
    const deadline = Date.now() + 5 * 60 * 1000; // 5 min safety cap
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data: job } = await axios.get(`${API}/jobs/${jobId}`);
      if (job.status === "done") return job.image;
      if (job.status === "failed") throw new Error(job.error || "Generation failed");
    }
    throw new Error("Timed out waiting for image");
  }, []);

  const setItemStatus = (index, patch) => {
    setItems((prev) =>
      prev.map((it) => (it.index === index ? { ...it, ...patch } : it))
    );
  };

  const handleGenerateAll = async () => {
    const parsed = parsePrompts(script);
    if (parsed.length === 0) {
      toast.error("No prompts found. Paste a numbered list first.");
      return;
    }
    if (keyMissing) {
      toast.error("Server API key not configured yet.");
    }
    const next = parsed.map((p, i) => ({
      index: i + 1,
      prompt: p.prompt,
      status: "pending",
      image: null,
    }));
    setItems(next);
    setRunning(true);
    cancelRef.current = false;
    setProgress({ current: 0, total: next.length });

    let failures = 0;
    for (let i = 0; i < next.length; i++) {
      if (cancelRef.current) break;
      const item = next[i];
      setProgress({ current: i + 1, total: next.length });
      setItemStatus(item.index, { status: "generating" });
      try {
        const image = await generateOne(item.prompt);
        setItemStatus(item.index, { status: "done", image });
      } catch (e) {
        failures++;
        const msg =
          e?.response?.data?.detail || e.message || "Generation failed";
        setItemStatus(item.index, { status: "failed", error: msg });
      }
    }
    setRunning(false);
    if (!cancelRef.current) {
      const done = next.length - failures;
      toast.success(`Done — ${done} generated, ${failures} failed.`);
    }
  };

  const handleStop = () => {
    cancelRef.current = true;
    setRunning(false);
    toast("Stopping after current image…");
  };

  const handleRegenerate = async (index) => {
    const item = items.find((it) => it.index === index);
    if (!item) return;
    setItemStatus(index, { status: "generating" });
    try {
      const image = await generateOne(item.prompt);
      setItemStatus(index, { status: "done", image, error: undefined });
      toast.success(`Image ${pad(index, padWidth)} regenerated.`);
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || "Generation failed";
      setItemStatus(index, { status: "failed", error: msg });
      toast.error(`Image ${pad(index, padWidth)} failed again.`);
    }
  };

  const downloadOne = (item) => {
    const a = document.createElement("a");
    a.href = item.image;
    a.download = `${pad(item.index, padWidth)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadZip = async () => {
    const done = items.filter((it) => it.status === "done" && it.image);
    if (done.length === 0) {
      toast.error("No completed images to zip yet.");
      return;
    }
    const zip = new JSZip();
    for (const it of done) {
      const base64 = it.image.split(",")[1];
      zip.file(`${pad(it.index, padWidth)}.png`, base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "images.zip");
    toast.success(`Zipped ${done.length} images.`);
  };

  const doneCount = items.filter((it) => it.status === "done").length;
  const failedCount = items.filter((it) => it.status === "failed").length;
  const progressPct = progress.total
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="h-screen w-full flex overflow-hidden bg-background text-foreground font-mono">
      <Toaster position="bottom-right" />

      {/* LEFT: INPUT PANEL */}
      <aside className="w-full max-w-[420px] shrink-0 border-r border-border flex flex-col h-full">
        <header className="px-6 pt-7 pb-5 border-b border-border">
          <div className="flex items-center gap-2 text-muted-foreground text-xs tracking-widest uppercase">
            <Lightning weight="fill" className="text-white" size={16} />
            Batch Studio
          </div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-3 leading-none">
            SCRIPT&nbsp;→&nbsp;IMAGES
          </h1>
          <p className="text-muted-foreground text-xs mt-3 leading-relaxed">
            Paste a numbered list of prompts. One image is generated per line,
            in order.
          </p>
        </header>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-2 border-b border-border text-[11px] text-muted-foreground uppercase tracking-wider">
            <span>prompts.txt</span>
            <button
              data-testid="load-sample-btn"
              onClick={() => setScript(SAMPLE)}
              className="hover:text-white transition-colors"
            >
              load sample
            </button>
          </div>
          <textarea
            data-testid="prompt-textarea"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
            placeholder={"1. First scene description...\n2. Second scene...\n3. ..."}
            className="flex-1 min-h-0 w-full bg-transparent border-none outline-none resize-none p-6 text-sm leading-loose text-foreground placeholder:text-muted-foreground/40 thin-scroll"
          />
        </div>

        <div className="p-5 border-t border-border">
          {keyMissing && (
            <div
              data-testid="key-warning"
              className="mb-4 text-[11px] leading-relaxed text-[#FF3B30] border border-[#FF3B30]/40 hatch px-3 py-2"
            >
              XAI_API_KEY not set on server. Add it to backend/.env to generate.
            </div>
          )}
          {running ? (
            <Button
              data-testid="stop-btn"
              onClick={handleStop}
              className="w-full rounded-none py-6 text-base font-bold border border-[#FF3B30] bg-transparent text-[#FF3B30] hover:bg-[#FF3B30]/10"
            >
              STOP
            </Button>
          ) : (
            <Button
              data-testid="generate-all-btn"
              onClick={handleGenerateAll}
              className="w-full rounded-none py-6 text-base font-bold bg-white text-black hover:bg-white/90"
            >
              GENERATE ALL
            </Button>
          )}
          <div className="mt-3 flex justify-between text-[11px] text-muted-foreground uppercase tracking-wider">
            <span>{parsePrompts(script).length} prompts</span>
            <span>
              {doneCount} done · {failedCount} failed
            </span>
          </div>
        </div>
      </aside>

      {/* RIGHT: OUTPUT PANEL */}
      <main className="flex-1 min-w-0 relative dot-canvas overflow-y-auto thin-scroll">
        {/* Progress bar + zip toolbar */}
        <div className="sticky top-0 z-20 bg-background/85 backdrop-blur-md border-b border-border">
          <div className="flex items-center justify-between px-8 py-4">
            <div
              data-testid="progress-label"
              className="text-sm font-medium tracking-tight"
            >
              {running ? (
                <span className="text-[#3B82F6]">
                  GENERATING {progress.current} / {progress.total}…
                </span>
              ) : items.length ? (
                <span className="text-muted-foreground">
                  {doneCount}/{items.length} complete
                </span>
              ) : (
                <span className="text-muted-foreground">Output feed</span>
              )}
            </div>
            <Button
              data-testid="download-zip-btn"
              onClick={downloadZip}
              disabled={doneCount === 0}
              className="rounded-none border border-border bg-transparent text-foreground hover:bg-white/10 disabled:opacity-30 text-xs uppercase tracking-wider gap-2"
            >
              <Stack size={16} weight="bold" />
              Download ZIP
            </Button>
          </div>
          <div className="h-[3px] w-full bg-transparent">
            <div
              className="h-full bg-[#3B82F6] transition-[width] duration-300 ease-out"
              style={{ width: `${running || doneCount ? progressPct : 0}%` }}
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div
            data-testid="empty-state"
            className="h-[calc(100%-64px)] flex flex-col items-center justify-center text-center px-8"
          >
            <ImageSquare size={56} weight="thin" className="text-muted-foreground/40" />
            <p className="mt-6 text-muted-foreground text-sm max-w-xs leading-relaxed">
              Generated images will appear here as a vertical feed, numbered and
              ready to download.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-12 px-8 py-12 max-w-3xl mx-auto">
            {items.map((it) => (
              <ImageCard
                key={it.index}
                item={it}
                label={pad(it.index, padWidth)}
                onDownload={() => downloadOne(it)}
                onRegenerate={() => handleRegenerate(it.index)}
                busy={running}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ImageCard({ item, label, onDownload, onRegenerate, busy }) {
  const { status, image, prompt, error } = item;
  return (
    <div
      data-testid={`image-card-${item.index}`}
      className="fade-up border border-border bg-card"
    >
      {/* image area */}
      <div className="relative w-full bg-black flex items-center justify-center min-h-[220px]">
        {status === "done" && image && (
          <img
            src={image}
            alt={prompt}
            className="w-full h-auto block"
            data-testid={`image-${item.index}`}
          />
        )}
        {status === "generating" && (
          <div className="flex flex-col items-center gap-3 py-16 text-[#3B82F6]">
            <CircleNotch size={32} className="animate-spin" weight="bold" />
            <span className="text-xs uppercase tracking-widest">Generating…</span>
          </div>
        )}
        {status === "pending" && (
          <div className="py-16 text-muted-foreground/40 text-xs uppercase tracking-widest">
            Queued
          </div>
        )}
        {status === "failed" && (
          <div
            data-testid={`failed-${item.index}`}
            className="hatch w-full py-12 px-6 flex flex-col items-center gap-2 text-[#FF3B30]"
          >
            <Warning size={28} weight="fill" />
            <span className="text-sm font-bold uppercase tracking-wider">Failed</span>
            <span className="text-[11px] text-[#FF3B30]/70 text-center max-w-md break-words">
              {error}
            </span>
          </div>
        )}
      </div>

      {/* toolbar */}
      <div className="flex items-stretch border-t border-border">
        <div className="flex items-center px-4 py-3 border-r border-border">
          <span className="font-heading font-black text-lg tracking-tight tabular-nums">
            {label}
          </span>
        </div>
        <div className="flex-1 flex items-center px-4 py-3 min-w-0">
          <p className="text-[11px] text-muted-foreground truncate" title={prompt}>
            {prompt}
          </p>
        </div>
        <div className="flex items-stretch">
          {status === "done" && (
            <button
              data-testid={`download-btn-${item.index}`}
              onClick={onDownload}
              title="Download PNG"
              className="px-4 border-l border-border hover:bg-white/10 transition-colors flex items-center"
            >
              <DownloadSimple size={18} weight="bold" />
            </button>
          )}
          <button
            data-testid={`regenerate-btn-${item.index}`}
            onClick={onRegenerate}
            disabled={busy || status === "generating"}
            title="Regenerate"
            className="px-4 border-l border-border hover:bg-white/10 transition-colors flex items-center disabled:opacity-30"
          >
            <ArrowClockwise size={18} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
