import CopyButton from "./CopyButton.jsx";

export default function ContentCard({ item }) {
  if (!item) return null;
  const time = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const eventLabel = item.event ? item.event.replace(/_/g, " ") : "EVENT";

  const formatKey = (key) => key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");

  const tryParseJson = (raw) => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const extractJsonFromString = (value) => {
    const trimmed = value.trim();
    const direct = tryParseJson(trimmed);
    if (direct !== null) {
      return direct;
    }
    const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
    let match = fenceRegex.exec(trimmed);
    while (match) {
      const candidate = match[1].trim();
      const parsed = tryParseJson(candidate);
      if (parsed !== null) {
        return parsed;
      }
      match = fenceRegex.exec(trimmed);
    }
    return null;
  };

  const renderValue = (value) => {
    if (value === null || value === undefined) {
      return <span className="opacity-40">—</span>;
    }
    if (typeof value === "boolean") {
      return (
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.2em] uppercase ${value ? "bg-accent/15 text-accent" : "bg-border/30 text-foreground/60"}`}>
          {value ? "Yes" : "No"}
        </span>
      );
    }
    if (typeof value === "string") {
      const parsedJson = extractJsonFromString(value);
      if (parsedJson !== null) {
        return (
          <pre className="text-sm font-mono opacity-80 leading-relaxed custom-scroll overflow-auto bg-black/[0.015] dark:bg-white/[0.015] p-6 rounded-[24px] border border-border">
            {JSON.stringify(parsedJson, null, 2)}
          </pre>
        );
      }
      if (value.length > 140 || value.includes("\n")) {
        return (
          <pre className="text-sm font-mono opacity-80 leading-relaxed custom-scroll overflow-auto bg-black/[0.015] dark:bg-white/[0.015] p-6 rounded-[24px] border border-border">
            {value}
          </pre>
        );
      }
      return <span className="text-2xl font-semibold whitespace-pre-wrap break-words">{value}</span>;
    }
    if (typeof value === "object") {
      return (
        <pre className="text-sm font-mono opacity-80 leading-relaxed custom-scroll overflow-auto bg-black/[0.015] dark:bg-white/[0.015] p-6 rounded-[24px] border border-border">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    return <span className="text-2xl font-semibold">{String(value)}</span>;
  };

  const MAX_STRUCT_DEPTH = 6;

  function renderArray(items, depth) {
    if (!items.length) {
      return <span className="opacity-40">—</span>;
    }

    const isSimple = items.every((item) => {
      return item === null || ["string", "number", "boolean"].includes(typeof item);
    });

    const isObjectList = items.every((item) => {
      return item && typeof item === "object" && !Array.isArray(item);
    });

    const isSimpleObjectList = isObjectList && items.every((item) => {
      return Object.values(item).every((value) => {
        return value === null || ["string", "number", "boolean"].includes(typeof value);
      });
    });

    if (isSimple) {
      return (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={`item-${index}`} className="text-base">
              {renderValue(item)}
            </div>
          ))}
        </div>
      );
    }

    if (isSimpleObjectList) {
      return (
        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={`item-${index}`} className="rounded-[20px] border border-border bg-black/[0.02] dark:bg-white/[0.02] p-4">
              {renderKeyValueGrid(Object.entries(item), depth)}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {items.map((item, index) => (
          <div key={`item-${index}`} className="space-y-4 rounded-[24px] border border-border bg-black/[0.02] dark:bg-white/[0.02] p-5">
            <div className="text-[10px] font-bold tracking-[0.35em] uppercase opacity-40">
              Item {index + 1}
            </div>
            {renderStructured(item, depth + 1)}
          </div>
        ))}
      </div>
    );
  }

  function renderObject(obj, depth) {
    const entries = Object.entries(obj);
    if (!entries.length) {
      return <span className="opacity-40">—</span>;
    }
    if (depth >= MAX_STRUCT_DEPTH) {
      return renderValue(obj);
    }
    return renderKeyValueGrid(entries, depth);
  }

  function renderStructured(value, depth = 0) {
    if (value === null || value === undefined) {
      return renderValue(value);
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return renderValue(value);
    }
    if (Array.isArray(value)) {
      return renderArray(value, depth);
    }
    if (typeof value === "object") {
      return renderObject(value, depth);
    }
    return renderValue(value);
  }

  function renderKeyValueGrid(entries, depth = 0) {
    return (
      <div className="space-y-8">
        {entries.map(([key, value]) => (
          <div key={key} className="space-y-2">
            <div className="text-[10px] font-bold tracking-[0.35em] uppercase opacity-40">
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
    content = (
      <div className="space-y-12 py-4">
        <div className="space-y-3 text-center">
          <h2 className="text-4xl font-black tracking-tight">{item.agent}</h2>
          <div className="text-xs font-mono opacity-20">{time}</div>
        </div>
        <div className="markdown-body opacity-80 leading-relaxed text-xl font-light whitespace-pre-wrap">
          {item.prompt}
        </div>
      </div>
    );
  } else if (item.event && item.event.startsWith("WORKFLOW_")) {
    const step = item.event.replace("WORKFLOW_", "");
    content = (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center space-y-8 py-20">
        <div className="text-[10px] font-bold tracking-[0.5em] uppercase opacity-20">Lifecycle status</div>
        <h2 className="text-8xl font-black tracking-tighter opacity-10 leading-none uppercase">{step}</h2>
        {item.error && <pre className="text-red-500 font-mono text-xs max-w-xl whitespace-pre-wrap bg-red-50 dark:bg-red-900/5 p-6 rounded-[24px] mt-4">{item.error}</pre>}
      </div>
    );
  } else if (item.event === "PROMPT_REQUESTED" || item.event === "INTERACTION_REQUESTED") {
    const details = [
      ["slug", item.slug],
      ["targetKey", item.targetKey],
      ["type", item.type]
    ].filter((entry) => entry[1] !== undefined);

    content = (
      <div className="space-y-10 py-4">
        <div className="text-xs font-mono opacity-20">{time}</div>
        <div className="text-4xl font-bold tracking-tight text-balance leading-tight">
          {item.question || item.prompt || "Prompt"}
        </div>
        {item.prompt && item.question && item.prompt !== item.question && (
          <div className="text-lg font-medium opacity-70 whitespace-pre-wrap">{item.prompt}</div>
        )}
        {details.length > 0 && (
          <div className="pt-4">
            {renderKeyValueGrid(details)}
          </div>
        )}
      </div>
    );
  } else if (item.event === "PROMPT_ANSWERED" || item.event === "INTERACTION_SUBMITTED") {
    const responseValue = item.answer !== undefined ? item.answer : item.response;
    const details = [
      ["slug", item.slug],
      ["targetKey", item.targetKey]
    ].filter((entry) => entry[1] !== undefined);

    content = (
      <div className="space-y-10 py-4">
        <div className="text-xs font-mono opacity-20">{time}</div>
        <div className="text-4xl font-bold tracking-tight text-balance leading-tight">
          {renderValue(responseValue)}
        </div>
        {details.length > 0 && (
          <div className="pt-4">
            {renderKeyValueGrid(details)}
          </div>
        )}
      </div>
    );
  } else if (item.event === "AGENT_COMPLETED") {
    const details = [
      ["agent", item.agent],
      ["attempts", item.attempts]
    ].filter((entry) => entry[1] !== undefined);

    content = (
      <div className="space-y-12 py-4">
        {item.output !== undefined && (
          <div className="space-y-8">
            <div className="rounded-[28px] border border-border bg-accent/10 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-3xl font-black tracking-tight">
                    {item.agent ? `Output from ${item.agent}` : "Agent output"}
                  </div>
                </div>
                <div className="text-xs font-mono opacity-40">{time}</div>
              </div>
              <div className="mt-2 text-sm opacity-70">
                This is what the previous agent run produced.
              </div>
            </div>
            {renderStructured(item.output)}
          </div>
        )}
        {details.length > 0 && (
          <div className="pt-4">
            {renderKeyValueGrid(details)}
          </div>
        )}
      </div>
    );
  } else {
    const entries = Object.entries(item).filter(([key]) => key !== "event" && key !== "timestamp");
    const fallbackEntries = entries.length > 0 ? entries : [["event", item.event || "Event"]];

    content = (
      <div className="space-y-12 py-4">
        <div className="text-xs font-mono opacity-20">{time}</div>
        {renderKeyValueGrid(fallbackEntries)}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scroll px-12">
      <div className="content-width flex-1">
        <div className="flex items-center justify-between pt-10">
          <div className="text-[10px] font-bold tracking-[0.4em] uppercase opacity-30">{eventLabel}</div>
          <CopyButton text={item} />
        </div>
        {content}
      </div>
    </div>
  );
}
