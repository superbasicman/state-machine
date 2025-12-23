import CopyButton from "./CopyButton.jsx";

export default function ContentCard({ item }) {
  if (!item) return null;
  const time = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const eventLabel = item.event ? item.event.replace(/_/g, " ") : "EVENT";

  const renderValue = (value) => {
    if (value === null || value === undefined) {
      return <span className="opacity-40">—</span>;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
      if (looksLikeJson) {
        try {
          const parsed = JSON.parse(trimmed);
          return (
            <pre className="text-sm font-mono opacity-80 leading-relaxed custom-scroll overflow-auto bg-black/[0.015] dark:bg-white/[0.015] p-6 rounded-[24px] border border-border">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          );
        } catch (error) {
          return <span className="text-2xl font-semibold whitespace-pre-wrap break-words">{value}</span>;
        }
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

  const renderKeyValueGrid = (entries) => (
    <div className="space-y-8">
      {entries.map(([key, value]) => (
        <div key={key} className="space-y-2">
          <div className="text-[10px] font-bold tracking-[0.35em] uppercase opacity-40">
            {key.replace(/_/g, " ")}
          </div>
          <div className="text-base">{renderValue(value)}</div>
        </div>
      ))}
    </div>
  );

  let content = null;

  if (item.event === "AGENT_STARTED") {
    content = (
      <div className="space-y-12 py-24">
        <div className="space-y-3 text-center">
          <div className="text-xs font-bold tracking-[0.4em] uppercase opacity-40">Agent invocation</div>
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
      <div className="space-y-10 py-24">
        <div className="space-y-3">
          <div className="text-xs font-bold tracking-[0.4em] uppercase text-accent">Awaiting response</div>
          <div className="text-xs font-mono opacity-20">{time}</div>
        </div>
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
      <div className="space-y-10 py-24">
        <div className="space-y-3">
          <div className="text-xs font-bold tracking-[0.4em] uppercase text-accent">Response recorded</div>
          <div className="text-xs font-mono opacity-20">{time}</div>
        </div>
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
  } else {
    const entries = Object.entries(item).filter(([key]) => key !== "event" && key !== "timestamp");
    const fallbackEntries = entries.length > 0 ? entries : [["event", item.event || "Event"]];

    content = (
      <div className="space-y-12 py-24">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold tracking-[0.4em] uppercase opacity-40">{eventLabel}</div>
          <div className="flex items-center gap-6">
            <span className="text-xs font-mono opacity-20">{time}</span>
            <CopyButton text={item} />
          </div>
        </div>
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
