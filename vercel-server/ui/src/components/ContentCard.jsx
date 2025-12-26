import { useEffect, useState } from "react";
import CopyButton from "./CopyButton.jsx";
import { Bot, Brain, ChevronRight, Search, X } from "lucide-react";

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightText = (text, query) => {
  const source = String(text ?? "");
  const q = (query || "").trim();
  if (!q) return source;
  const regex = new RegExp(escapeRegExp(q), "gi");
  const matches = source.match(regex);
  if (!matches) return source;

  const parts = source.split(regex);
  const nodes = [];

  parts.forEach((part, index) => {
    nodes.push(part);
    if (index < matches.length) {
      nodes.push(
        <mark
          key={`mark-${index}`}
          className="rounded bg-black/10 dark:bg-white/20 px-1"
        >
          {matches[index]}
        </mark>
      );
    }
  });

  return nodes;
};

function AgentStartedIcon({ className = "" }) {
  return (
    <div
      className={`mx-auto w-14 h-14 rounded-full border border-black dark:border-white flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      <Bot className="w-7 h-7" />
    </div>
  );
}

function MonoBlock({ children }) {
  return (
    <pre className="text-xs sm:text-sm font-mono leading-relaxed whitespace-pre-wrap break-words overflow-auto max-h-[60vh] p-6 rounded-[24px] border border-black bg-black text-white/90 dark:border-white dark:bg-white dark:text-black/90">
      {children}
    </pre>
  );
}

function TextBlock({ children }) {
  return (
    <div className="rounded-[24px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-6 text-base sm:text-lg leading-relaxed whitespace-pre-wrap break-words text-black/80 dark:text-white/80">
      {children}
    </div>
  );
}

function PanelBody({ as: Component = "div", className = "", children }) {
  return (
    <Component
      className={`border-t border-black/10 dark:border-white/10 p-6 ${className}`}
    >
      {children}
    </Component>
  );
}

function RawToggle({ open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="px-3 py-1 rounded-full text-[10px] font-bold tracking-[0.2em] uppercase border border-black/20 dark:border-white/20 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:border-black/40 dark:hover:border-white/40 transition-colors"
      aria-pressed={open}
      aria-label={open ? "Hide raw event JSON" : "Show raw event JSON"}
    >
      Raw
    </button>
  );
}

const renderInlineValue = (value) => {
  if (value === null || value === undefined) {
    return <span className="italic">—</span>;
  }
  if (typeof value === "string") {
    if (value.length > 140 || value.includes("\n")) {
      return <TextBlock>{value}</TextBlock>;
    }
    return (
      <span className="text-lg sm:text-xl font-semibold whitespace-pre-wrap break-words">
        {value}
      </span>
    );
  }
  if (typeof value === "object") {
    return <pre className="raw-json-block raw-json-block--full">{renderJsonWithHighlight(value)}</pre>;
  }
  return <span className="text-lg sm:text-xl font-semibold break-words">{String(value)}</span>;
};

function renderJsonWithHighlight(value) {
  const raw = JSON.stringify(value, null, 2);
  const regex =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    const { index } = match;
    if (index > lastIndex) {
      nodes.push(raw.slice(lastIndex, index));
    }

    const token = match[0];
    let className = "json-token-number";
    if (token.startsWith('"')) {
      className = token.endsWith(":") ? "json-token-key" : "json-token-string";
    } else if (token === "true" || token === "false") {
      className = "json-token-boolean";
    } else if (token === "null") {
      className = "json-token-null";
    }

    nodes.push(
      <span key={`json-${index}`} className={className}>
        {token}
      </span>
    );

    lastIndex = index + token.length;
  }

  if (lastIndex < raw.length) {
    nodes.push(raw.slice(lastIndex));
  }

  return nodes;
}

export default function ContentCard({ item, promptSearchRequestId = 0 }) {
  if (!item) return null;

  const time = new Date(item.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const [promptQuery, setPromptQuery] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [showPromptSearch, setShowPromptSearch] = useState(false);

  // Full-auto countdown logic (must be at top level for hooks rules)
  const isInteractionEvent = item.event === "PROMPT_REQUESTED" || item.event === "INTERACTION_REQUESTED";
  const isFullAuto = isInteractionEvent && !!item.fullAuto;
  const interactionType = item.type || "text";
  const interactionOptions = item.options || [];
  const autoSelectDelay = item.autoSelectDelay ?? 20;
  const shouldShowCountdown = isFullAuto && interactionType === "choice" && interactionOptions.length > 0;

  // Calculate countdown directly - triggers re-render via tick state
  const [tick, setTick] = useState(0);

  const countdown = (() => {
    if (!shouldShowCountdown) return null;
    const eventTime = new Date(item.timestamp).getTime();
    const elapsed = Math.floor((Date.now() - eventTime) / 1000);
    return autoSelectDelay - elapsed;
  })();

  useEffect(() => {
    if (!shouldShowCountdown) return;

    const timer = setInterval(() => {
      setTick(t => t + 1); // Force re-render to recalculate countdown
    }, 1000);

    return () => clearInterval(timer);
  }, [shouldShowCountdown, item.timestamp]);

  const formatKey = (key) => {
    const spaced = key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const tryParseJson = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const extractJsonFromString = (value) => {
    const trimmed = value.trim();
    const direct = tryParseJson(trimmed);
    if (direct !== null) return direct;

    const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
    let match = fenceRegex.exec(trimmed);

    while (match) {
      const candidate = match[1].trim();
      const parsed = tryParseJson(candidate);
      if (parsed !== null) return parsed;
      match = fenceRegex.exec(trimmed);
    }

    return null;
  };

  const estimateTokensFromText = (text) => {
    const s = String(text ?? "").trim();
    if (!s) return 0;
    // Heuristic: ~1 token per ~4 characters (good-enough UI estimate).
    return Math.max(1, Math.round(s.length / 4));
  };

  const formatTokenCount = (count) => {
    if (!count) return "0 tokens";
    if (count >= 1_000_000) {
      const v = (count / 1_000_000).toFixed(1).replace(/\.0$/, "");
      return `${v}M tokens`;
    }
    if (count >= 10_000) {
      return `${Math.round(count / 1000)}k tokens`;
    }
    if (count >= 1000) {
      const v = (count / 1000).toFixed(1).replace(/\.0$/, "");
      return `${v}k tokens`;
    }
    return `${count} tokens`;
  };

  const extractContextFromPrompt = (promptText) => {
    if (typeof promptText !== "string" || !promptText.trim()) {
      return { cleanedPrompt: "", contextTitle: null, contextData: null, contextRaw: "" };
    }

    // Matches:
    // "Context\n\n```json\n{...}\n```"
    // "# Current Context\n\n```json\n{...}\n```"
    // "## Context\n```json\n{...}\n```"
    const re =
      /(^|\n)(?:#+\s*)?(Current\s+)?Context\s*\n+```json\s*([\s\S]*?)\s*```/i;

    const match = re.exec(promptText);
    if (!match) {
      return { cleanedPrompt: promptText, contextTitle: null, contextData: null, contextRaw: "" };
    }

    const contextTitle = match[2] ? "Current Context" : "Context";
    const contextRaw = (match[3] || "").trim();
    const parsed = tryParseJson(contextRaw);

    const before = promptText.slice(0, match.index);
    const after = promptText.slice(match.index + match[0].length);

    const cleanedPrompt = `${before}\n\n${after}`.replace(/\n{3,}/g, "\n\n").trim();

    return {
      cleanedPrompt,
      contextTitle,
      contextData: parsed ?? contextRaw,
      contextRaw,
    };
  };

  const splitPromptSections = (promptText) => {
    if (typeof promptText !== "string" || !promptText.trim()) return [];
    const lines = promptText.split(/\r?\n/);
    const sections = [];
    let current = null;
    let inFence = false;

    const pushSection = () => {
      if (!current) return;
      const content = current.content.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!content) {
        current = null;
        return;
      }
      sections.push({ title: current.title || "Prompt", content });
      current = null;
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
      }
      if (!trimmed) {
        if (current) current.content.push("");
        return;
      }
      if (!inFence && /^---+$/.test(trimmed)) {
        pushSection();
        return;
      }
      const headingMatch = !inFence ? /^(#{1,6})\s+(.+)$/.exec(trimmed) : null;
      if (headingMatch) {
        pushSection();
        current = { title: headingMatch[2].trim(), content: [] };
        return;
      }
      if (!current) current = { title: "Prompt", content: [] };
      current.content.push(line);
    });

    pushSection();
    return sections;
  };

  const renderPromptSectionContent = (content, query) => {
    if (!content) {
      return (
        <PanelBody className="italic text-black/40 dark:text-white/40">—</PanelBody>
      );
    }
    if (content.includes("```")) {
      return (
        <PanelBody
          as="pre"
          className="text-xs sm:text-sm font-mono leading-relaxed whitespace-pre-wrap break-words overflow-auto max-h-[60vh] text-black/90 dark:text-white/90"
        >
          {highlightText(content, query)}
        </PanelBody>
      );
    }
    return (
      <PanelBody className="text-base sm:text-lg leading-relaxed whitespace-pre-wrap break-words text-black/80 dark:text-white/80">
        {highlightText(content, query)}
      </PanelBody>
    );
  };

  const renderValue = (value) => {
    if (value === null || value === undefined) {
      return <span className="italic">—</span>;
    }

    if (typeof value === "boolean") {
      const base =
        "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase border";
      return value ? (
        <span className={`${base} bg-black text-white border-black dark:bg-white dark:text-black dark:border-white`}>
          Yes
        </span>
      ) : (
        <span className={`${base} bg-white text-black border-black dark:bg-black dark:text-white dark:border-white`}>
          No
        </span>
      );
    }

    if (typeof value === "string") {
      const parsedJson = extractJsonFromString(value);
      if (parsedJson !== null) {
        return renderStructured(parsedJson);
      }

      if (value.length > 140 || value.includes("\n")) {
        return <TextBlock>{value}</TextBlock>;
      }

      return (
        <span className="text-lg sm:text-xl font-semibold whitespace-pre-wrap break-words">
          {value}
        </span>
      );
    }

    if (typeof value === "object") {
      return <MonoBlock>{JSON.stringify(value, null, 2)}</MonoBlock>;
    }

    return <span className="text-lg sm:text-xl font-semibold break-words">{String(value)}</span>;
  };

  const MAX_STRUCT_DEPTH = 6;

  function renderArray(items, depth) {
    if (!items.length) return <span className="italic">—</span>;

    const isSimple = items.every(
      (entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry)
    );

    const isObjectList = items.every(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    );

    const isSimpleObjectList =
      isObjectList &&
      items.every((entry) =>
        Object.values(entry).every(
          (val) => val === null || ["string", "number", "boolean"].includes(typeof val)
        )
      );

    if (isSimple) {
      return (
        <div className="space-y-3">
          {items.map((entry, index) => (
            <div key={`item-${index}`} className="text-base sm:text-lg">
              {renderValue(entry)}
            </div>
          ))}
        </div>
      );
    }

    if (isSimpleObjectList) {
      return (
        <div className="space-y-4">
          {items.map((entry, index) => (
            <div
              key={`item-${index}`}
              className="rounded-[20px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-4"
            >
              {renderKeyValueGrid(Object.entries(entry), depth)}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {items.map((entry, index) => (
          <div
            key={`item-${index}`}
            className="space-y-4 rounded-[24px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-5"
          >
            <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50">
              Item {index + 1}
            </div>
            {renderStructured(entry, depth + 1)}
          </div>
        ))}
      </div>
    );
  }

  function renderObject(obj, depth) {
    const entries = Object.entries(obj);
    if (!entries.length) return <span className="italic">—</span>;
    if (depth >= MAX_STRUCT_DEPTH) return renderValue(obj);
    return renderKeyValueGrid(entries, depth);
  }

  function renderStructured(value, depth = 0) {
    if (value === null || value === undefined) return renderValue(value);

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return renderValue(value);
    }

    if (Array.isArray(value)) return renderArray(value, depth);
    if (typeof value === "object") return renderObject(value, depth);

    return renderValue(value);
  }

  function renderKeyValueGrid(entries, depth = 0) {
    return (
      <div className="space-y-6">
        {entries.map(([key, value]) => (
          <div key={key} className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-start min-w-0">
            <div className="text-xs font-semibold text-black/50 dark:text-white/50 break-words">
              {formatKey(key)}
            </div>
            <div className="text-base sm:text-lg leading-relaxed break-words min-w-0">
              {renderStructured(value, depth + 1)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  let content = null;

  useEffect(() => {
    if (promptSearchRequestId > 0) {
      setShowPromptSearch(true);
    }
  }, [promptSearchRequestId]);

  if (item.event === "AGENT_STARTED") {
    const { cleanedPrompt, contextTitle, contextData, contextRaw } = extractContextFromPrompt(
      item.prompt || ""
    );
    const promptSections = splitPromptSections(cleanedPrompt);
    const trimmedPromptQuery = promptQuery.trim();
    const normalizedPromptQuery = trimmedPromptQuery.toLowerCase();
    const filteredPromptSections = trimmedPromptQuery
      ? promptSections.filter((section) =>
          `${section.title}\n${section.content}`.toLowerCase().includes(normalizedPromptQuery)
        )
      : [];
    const promptCountLabel = promptSections.length ? `${promptSections.length} sections` : null;

    const contextTokenCount = estimateTokensFromText(contextRaw || "");
    const contextMeta = contextRaw ? `~${formatTokenCount(contextTokenCount)}` : "";

    content = (
      <div className="space-y-10 py-6">
        <div className="space-y-3 text-center">
          <AgentStartedIcon />
          <div className="space-y-1">
            <div className="text-[11px] font-semibold tracking-[0.28em] uppercase text-black/50 dark:text-white/50">
              Agent started
            </div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">{item.agent}</h2>
          </div>
        </div>

        {contextTitle && contextData !== null && (
          <details className="group rounded-[24px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04]">
            <summary className="cursor-pointer select-none px-6 py-5 flex items-center justify-between gap-6 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center gap-3">
                <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                {contextTitle === "Current Context" ? (
                  <Brain className="w-4 h-4" aria-hidden="true" />
                ) : null}
                <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/60 dark:text-white/60">
                  {contextTitle}
                </div>
              </div>
              {contextMeta ? <div className="text-xs font-mono text-black/50 dark:text-white/50">{contextMeta}</div> : null}
            </summary>

            {typeof contextData === "string" ? (
              <PanelBody className="text-base sm:text-lg leading-relaxed whitespace-pre-wrap break-words text-black/80 dark:text-white/80">
                {contextData}
              </PanelBody>
            ) : (
              <PanelBody>{renderStructured(contextData)}</PanelBody>
            )}
          </details>
        )}

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50">
              Prompt
            </div>
            {promptCountLabel ? (
              <div className="text-xs font-mono text-black/40 dark:text-white/40">
                {promptCountLabel}
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            {promptSections.length > 0 ? (
              promptSections.map((section, index) => {
                const isInstructions = /(^| )instructions$/i.test(section.title.trim());
                const shouldOpen = index === 0 || isInstructions;
                const lineCount = section.content
                  ? section.content.split(/\r?\n/).length
                  : 0;
                return (
                  <details
                    key={`${section.title}-${index}`}
                    open={shouldOpen}
                    className="group rounded-[24px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04]"
                  >
                    <summary className="cursor-pointer select-none px-6 py-5 flex items-center justify-between gap-6 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-3 min-w-0">
                        <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                        <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/60 dark:text-white/60 break-words">
                          {section.title || "Prompt"}
                        </div>
                      </div>
                      {lineCount ? (
                        <div className="text-xs font-mono text-black/40 dark:text-white/40">
                          {lineCount} lines
                        </div>
                      ) : null}
                    </summary>
                    {renderPromptSectionContent(section.content, "")}
                  </details>
                );
              })
            ) : (
              <TextBlock>{cleanedPrompt}</TextBlock>
            )}
          </div>
        </div>

        {showPromptSearch ? (
          <div className="fixed inset-0 z-40 bg-white text-black dark:bg-black dark:text-white">
            <div className="h-full w-full overflow-y-auto custom-scroll px-6 sm:px-10 py-10">
              <div className="max-w-3xl mx-auto space-y-8">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="text-[11px] font-semibold tracking-[0.32em] uppercase text-black/50 dark:text-white/50">
                    Prompt search
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPromptSearch(false)}
                    className="text-[10px] font-bold tracking-[0.2em] uppercase text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
                  >
                    Close
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-black/50 dark:text-white/60 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={promptQuery}
                    onChange={(event) => setPromptQuery(event.target.value)}
                    placeholder="Search the prompt..."
                    className="w-full rounded-full border border-black/20 dark:border-white/20 bg-transparent py-4 pl-11 pr-10 text-base text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-black/30 dark:focus:ring-white/40"
                    autoFocus
                  />
                  {trimmedPromptQuery ? (
                    <button
                      type="button"
                      onClick={() => setPromptQuery("")}
                      aria-label="Clear prompt search"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>

                {trimmedPromptQuery ? (
                  filteredPromptSections.length > 0 ? (
                    <div className="space-y-4">
                      {filteredPromptSections.map((section, index) => {
                        const lineCount = section.content
                          ? section.content.split(/\r?\n/).length
                          : 0;
                        return (
                          <div
                            key={`${section.title}-${index}`}
                            className="rounded-[22px] border border-black/10 dark:border-white/15 bg-black/[0.02] dark:bg-white/5 overflow-hidden"
                          >
                            <div className="px-5 py-4 flex items-center justify-between gap-4">
                              <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/70 dark:text-white/70 break-words">
                                {highlightText(section.title || "Prompt", trimmedPromptQuery)}
                              </div>
                              {lineCount ? (
                                <div className="text-xs font-mono text-black/50 dark:text-white/50">
                                  {lineCount} lines
                                </div>
                              ) : null}
                            </div>
                            <div className="border-t border-black/10 dark:border-white/10 p-5">
                              <pre className="m-0 text-xs sm:text-sm font-mono leading-relaxed whitespace-pre-wrap break-words text-black/85 dark:text-white/85">
                                {highlightText(section.content || "", trimmedPromptQuery)}
                              </pre>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[20px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/5 p-5 text-sm text-black/60 dark:text-white/60">
                      No prompt sections match "{trimmedPromptQuery}".
                    </div>
                  )
                ) : (
                  <div className="text-sm text-black/50 dark:text-white/50">
                    Start typing to filter prompt sections.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  } else if (item.event && item.event.startsWith("WORKFLOW_")) {
    const step = item.event.replace("WORKFLOW_", "");
    content = (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center space-y-8 py-16">
        <div className="text-[10px] font-semibold tracking-[0.4em] uppercase text-black/50 dark:text-white/50">
          Lifecycle status
        </div>

        <div className="w-full max-w-5xl rounded-[28px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-10">
          <h2 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tighter leading-none uppercase">
            {step}
          </h2>

          {item.error && (
            <div className="mt-6">
              <MonoBlock>{item.error}</MonoBlock>
            </div>
          )}
        </div>
      </div>
    );
  } else if (item.event === "PROMPT_REQUESTED" || item.event === "INTERACTION_REQUESTED") {
    const isInteraction = item.event === "INTERACTION_REQUESTED";
    const label = isInteraction ? "Interaction needed" : "Question asked";
    const headline = item.question || item.prompt || "Prompt";
    const agentName = item.agent || item.slug || "Agent";

    content = (
      <div className="py-10 sm:py-14 space-y-8">
        <div className="text-center space-y-4">
          <AgentStartedIcon className="w-12 h-12" />
          <div className="text-[11px] font-semibold tracking-[0.32em] uppercase text-black/50 dark:text-white/50">
            {label}
          </div>
          <div className="text-lg sm:text-xl font-semibold text-black/70 dark:text-white/70">
            {agentName} needs your input
          </div>
        </div>
        <div className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight text-center text-balance">
          {headline}
        </div>

        {shouldShowCountdown && countdown !== null && (
          <div className="text-center">
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
              countdown > 0
                ? "bg-black/5 dark:bg-white/10"
                : "bg-black text-white dark:bg-white dark:text-black"
            }`}>
              <span className="text-xl">⚡</span>
              <span className={`text-sm font-semibold ${
                countdown > 0 ? "text-black/70 dark:text-white/70" : ""
              }`}>
                {countdown > 0
                  ? `Agent deciding in ${countdown}s...`
                  : "Auto-selected"}
              </span>
            </div>
          </div>
        )}

        {interactionType === "choice" && interactionOptions.length > 0 && (
          <div className="space-y-3 max-w-2xl mx-auto">
            <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50 text-center">
              Options
            </div>
            <div className="space-y-2">
              {interactionOptions.map((opt, index) => (
                <div
                  key={opt.key || index}
                  className={`p-4 rounded-2xl border transition-all ${
                    index === 0
                      ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`font-bold ${index === 0 ? "" : "text-black dark:text-white"}`}>
                      {opt.label || opt.key}
                      {index === 0 && (
                        <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                          "bg-white/20 dark:bg-black/20"
                        }`}>
                          Recommended
                        </span>
                      )}
                    </div>
                  </div>
                  {opt.description && (
                    <div className={`text-sm mt-1 ${
                      index === 0 ? "text-white/70 dark:text-black/70" : "text-black/50 dark:text-white/50"
                    }`}>
                      {opt.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {item.allowCustom && (
              <div className="text-xs text-center text-black/40 dark:text-white/40 mt-2">
                Custom response allowed
              </div>
            )}
          </div>
        )}
      </div>
    );
  } else if (item.event === "INTERACTION_AUTO_RESOLVED" || item.event === "PROMPT_AUTO_ANSWERED") {
    const autoSelected = item.autoSelected || "Unknown";
    const agentName = item.agent || item.slug || "Agent";

    content = (
      <div className="space-y-8 py-6">
        <div className="space-y-4 text-center">
          <div className="mx-auto w-14 h-14 rounded-full border-2 border-black dark:border-white bg-black dark:bg-white flex items-center justify-center">
            <span className="text-2xl">⚡</span>
          </div>
          <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50">
            Auto-selected
          </div>
          <div className="text-lg sm:text-xl font-semibold text-black/70 dark:text-white/70">
            {agentName} decided automatically
          </div>
        </div>
        <div className="rounded-[24px] border-2 border-black bg-black text-white dark:border-white dark:bg-white dark:text-black p-6 text-center max-w-md mx-auto">
          <div className="text-2xl sm:text-3xl font-black tracking-tight">
            {autoSelected}
          </div>
        </div>
      </div>
    );
  } else if (item.event === "INTERACTION_RESOLVED") {
    const resolvedCopy =
      item.source === "remote" ? "Remote response received." : "Response captured.";
    const sourceCopy =
      item.source === "remote" ? "Received from remote" : item.source ? `Received from ${item.source}` : "Received";
    const agentName = item.agent || item.slug || "Agent";

    content = (
      <div className="space-y-8 py-6">
        <div className="space-y-4 text-center">
          <AgentStartedIcon className="w-12 h-12" />
          <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50">
            Interaction resolved
          </div>
          <div className="text-lg sm:text-xl font-semibold text-black/70 dark:text-white/70">
            {agentName} received your response
          </div>
        </div>
        <div className="rounded-[24px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-6 text-center">
          <div className="text-xl sm:text-2xl font-semibold leading-relaxed text-balance">
            {resolvedCopy}
          </div>
          <div className="mt-3 text-sm text-black/60 dark:text-white/60">
            {sourceCopy}
          </div>
        </div>
      </div>
    );
  } else if (item.event === "PROMPT_ANSWERED" || item.event === "INTERACTION_SUBMITTED") {
    const responseValue = item.answer !== undefined ? item.answer : item.response;

    content = (
      <div className="space-y-8 py-6">
        <div className="space-y-3">
          <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50">
            Response sent
          </div>
          {renderInlineValue(responseValue)}
        </div>
      </div>
    );
  } else if (item.event === "AGENT_COMPLETED") {
    content = (
      <div className="space-y-10 py-6">
        <div className="rounded-[28px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-6 sm:p-8 text-center space-y-4">
          <AgentStartedIcon className="w-12 h-12" />
          <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50">
            Agent completed
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-tight">
            {item.agent || "Agent"}
          </div>
          {typeof item.attempts === "number" ? (
            <div className="text-sm text-black/60 dark:text-white/60">
              {item.attempts} {item.attempts === 1 ? "attempt" : "attempts"}
            </div>
          ) : null}
        </div>

        {item.output !== undefined ? (
          <div className="space-y-4">
            <div className="text-[11px] font-semibold tracking-[0.24em] uppercase text-black/50 dark:text-white/50">
              Answer
            </div>
            <div className="rounded-[24px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-6">
              {renderStructured(item.output)}
            </div>
          </div>
        ) : null}
      </div>
    );
  } else {
    const entries = Object.entries(item).filter(
      ([key]) => key !== "event" && key !== "timestamp"
    );

    content = (
      <div className="space-y-6 py-6">
        <div className="rounded-[24px] border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] p-6">
          <div className="text-lg sm:text-xl font-semibold leading-relaxed text-balance">
            {item.event ? item.event.replace(/_/g, " ") : "Event"}
          </div>
          <div className="mt-3 text-sm text-black/60 dark:text-white/60">
            {entries.length > 0 ? "Open Raw for full details." : "Open Raw for more info."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scroll px-6 sm:px-10 lg:px-12 bg-white text-black dark:bg-black dark:text-white">
      <div className="content-width flex-1">
        <div className="flex flex-wrap items-center justify-between gap-4 pt-8 sm:pt-10 pb-6 border-b border-black/10 dark:border-white/10">
          <div className="text-xs font-mono text-black/50 dark:text-white/50">{time}</div>
          <div className="flex items-center gap-3">
            <RawToggle open={showRaw} onToggle={() => setShowRaw((prev) => !prev)} />
            <CopyButton text={item} />
          </div>
        </div>
        {showRaw ? (
          <pre className="raw-json-block">{renderJsonWithHighlight(item)}</pre>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
