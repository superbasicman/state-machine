import CopyButton from "./CopyButton.jsx";
import { Bot, ChevronRight } from "lucide-react";

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

export default function ContentCard({ item }) {
  if (!item) return null;

  const time = new Date(item.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const eventLabel = item.event ? item.event.replace(/_/g, " ") : "EVENT";

  const formatKey = (key) =>
    key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");

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

  const MonoBlock = ({ children }) => (
    <pre className="text-sm font-mono leading-relaxed overflow-auto p-6 rounded-[24px] border border-black bg-black text-white dark:border-white dark:bg-white dark:text-black">
      {children}
    </pre>
  );

  const renderValue = (value) => {
    if (value === null || value === undefined) {
      return <span className="italic">—</span>;
    }

    if (typeof value === "boolean") {
      const base =
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.2em] uppercase border";
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
        return <MonoBlock>{JSON.stringify(parsedJson, null, 2)}</MonoBlock>;
      }

      if (value.length > 140 || value.includes("\n")) {
        return <MonoBlock>{value}</MonoBlock>;
      }

      return (
        <span className="text-2xl font-semibold whitespace-pre-wrap break-words">
          {value}
        </span>
      );
    }

    if (typeof value === "object") {
      return <MonoBlock>{JSON.stringify(value, null, 2)}</MonoBlock>;
    }

    return <span className="text-2xl font-semibold">{String(value)}</span>;
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
        <div className="space-y-2">
          {items.map((entry, index) => (
            <div key={`item-${index}`} className="text-base">
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
              className="rounded-[20px] border border-black p-4 dark:border-white"
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
            className="space-y-4 rounded-[24px] border border-black p-5 dark:border-white"
          >
            <div className="text-[10px] font-bold tracking-[0.35em] uppercase">
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
      <div className="space-y-8">
        {entries.map(([key, value]) => (
          <div key={key} className="space-y-2">
            <div className="text-[10px] font-bold tracking-[0.35em] uppercase">
              {formatKey(key)}
            </div>
            <div className="text-base">{renderStructured(value, depth + 1)}</div>
          </div>
        ))}
      </div>
    );
  }

  let content = null;

  if (item.event === "AGENT_STARTED") {
    const { cleanedPrompt, contextTitle, contextData, contextRaw } = extractContextFromPrompt(
      item.prompt || ""
    );

    const contextTokenCount = estimateTokensFromText(contextRaw || "");
    const contextMeta = contextRaw ? `~${formatTokenCount(contextTokenCount)}` : "";

    content = (
      <div className="space-y-12 py-4">
        <div className="space-y-4 text-center">
          <AgentStartedIcon />
          <div className="space-y-2">
            <h2 className="text-4xl font-black tracking-tight">{item.agent}</h2>
            <div className="text-xs font-mono">{time}</div>
          </div>
        </div>

        {contextTitle && contextData !== null && (
          <details className="group rounded-[24px] border border-black dark:border-white">
            <summary className="cursor-pointer select-none px-6 py-5 flex items-center justify-between gap-6 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center gap-3">
                <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                <div className="text-sm font-semibold tracking-[0.12em] uppercase">
                  {contextTitle}
                </div>
              </div>
              {contextMeta ? <div className="text-xs font-mono">{contextMeta}</div> : null}
            </summary>

            <div className="border-t border-black dark:border-white p-6">
              {typeof contextData === "string" ? (
                <MonoBlock>{contextData}</MonoBlock>
              ) : (
                renderStructured(contextData)
              )}
            </div>
          </details>
        )}

        <div className="markdown-body leading-relaxed text-xl font-light whitespace-pre-wrap [&_*]:text-inherit [&_a]:underline">
          {cleanedPrompt}
        </div>
      </div>
    );
  } else if (item.event && item.event.startsWith("WORKFLOW_")) {
    const step = item.event.replace("WORKFLOW_", "");
    content = (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center space-y-8 py-20">
        <div className="text-[10px] font-bold tracking-[0.5em] uppercase">
          Lifecycle status
        </div>

        <div className="w-full max-w-5xl rounded-[28px] border border-black p-10 dark:border-white">
          <h2 className="text-6xl sm:text-7xl md:text-8xl font-black tracking-tighter leading-none uppercase">
            {step}
          </h2>

          {item.error && (
            <pre className="mt-8 text-xs font-mono whitespace-pre-wrap rounded-[24px] border border-black p-6 bg-black text-white dark:border-white dark:bg-white dark:text-black">
              {item.error}
            </pre>
          )}
        </div>
      </div>
    );
  } else if (item.event === "PROMPT_REQUESTED" || item.event === "INTERACTION_REQUESTED") {
    const details = [
      ["slug", item.slug],
      ["targetKey", item.targetKey],
      ["type", item.type],
    ].filter((entry) => entry[1] !== undefined);

    content = (
      <div className="space-y-10 py-4">
        <div className="text-xs font-mono">{time}</div>

        <div className="text-4xl font-bold tracking-tight text-balance leading-tight">
          {item.question || item.prompt || "Prompt"}
        </div>

        {item.prompt && item.question && item.prompt !== item.question && (
          <div className="text-lg font-medium whitespace-pre-wrap">{item.prompt}</div>
        )}

        {details.length > 0 && <div className="pt-4">{renderKeyValueGrid(details)}</div>}
      </div>
    );
  } else if (item.event === "PROMPT_ANSWERED" || item.event === "INTERACTION_SUBMITTED") {
    const responseValue = item.answer !== undefined ? item.answer : item.response;

    const details = [
      ["slug", item.slug],
      ["targetKey", item.targetKey],
    ].filter((entry) => entry[1] !== undefined);

    content = (
      <div className="space-y-10 py-4">
        <div className="text-xs font-mono">{time}</div>

        <div className="text-4xl font-bold tracking-tight text-balance leading-tight">
          {renderValue(responseValue)}
        </div>

        {details.length > 0 && <div className="pt-4">{renderKeyValueGrid(details)}</div>}
      </div>
    );
  } else if (item.event === "AGENT_COMPLETED") {
    const details = [
      ["agent", item.agent],
      ["attempts", item.attempts],
    ].filter((entry) => entry[1] !== undefined);

    content = (
      <div className="space-y-12 py-4">
        {item.output !== undefined && (
          <div className="space-y-8">
            <div className="rounded-[28px] border border-black px-6 py-5 dark:border-white">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-3xl font-black tracking-tight">
                  {item.agent ? `Output from ${item.agent}` : "Agent output"}
                </div>
                <div className="text-xs font-mono">{time}</div>
              </div>
              <div className="mt-2 text-sm">
                This is what the previous agent run produced.
              </div>
            </div>

            {renderStructured(item.output)}
          </div>
        )}

        {details.length > 0 && <div className="pt-4">{renderKeyValueGrid(details)}</div>}
      </div>
    );
  } else {
    const entries = Object.entries(item).filter(
      ([key]) => key !== "event" && key !== "timestamp"
    );

    const fallbackEntries = entries.length > 0 ? entries : [["event", item.event || "Event"]];

    content = (
      <div className="space-y-12 py-4">
        <div className="text-xs font-mono">{time}</div>
        {renderKeyValueGrid(fallbackEntries)}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scroll px-12 bg-white text-black dark:bg-black dark:text-white">
      <div className="content-width flex-1">
        <div className="flex items-center justify-between pt-10">
          <div className="text-[10px] font-bold tracking-[0.4em] uppercase">
            {eventLabel}
          </div>
          <CopyButton text={item} />
        </div>
        {content}
      </div>
    </div>
  );
}
