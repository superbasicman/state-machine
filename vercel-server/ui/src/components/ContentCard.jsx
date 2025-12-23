import CopyButton from "./CopyButton.jsx";

export default function ContentCard({ item }) {
  if (!item) return null;
  const time = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

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
  } else if (item.event === "INTERACTION_SUBMITTED") {
    content = (
      <div className="space-y-12 py-24">
        <div className="space-y-3">
          <div className="text-xs font-bold tracking-[0.4em] uppercase text-accent">Response committed</div>
          <div className="text-xs font-mono opacity-20">{time}</div>
        </div>
        <div className="text-4xl font-bold tracking-tight text-balance leading-tight">
          {item.answer || item.response}
        </div>
      </div>
    );
  } else {
    content = (
      <div className="space-y-12 py-24">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold tracking-[0.4em] uppercase opacity-40">{item.event || "Event"}</div>
          <div className="flex items-center gap-6">
            <span className="text-xs font-mono opacity-20">{time}</span>
            <CopyButton text={item} />
          </div>
        </div>
        <pre className="text-sm font-mono opacity-80 leading-relaxed custom-scroll overflow-auto bg-black/[0.015] dark:bg-white/[0.015] p-10 rounded-[32px] border border-border">
          {JSON.stringify(item, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scroll px-12">
      <div className="content-width flex-1">
        {content}
      </div>
    </div>
  );
}
