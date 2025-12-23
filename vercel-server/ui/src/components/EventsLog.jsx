import { Terminal, Send, Play, AlertCircle, CheckCircle2 } from "lucide-react";

const getEventIcon = (event) => {
    if (!event) return <Terminal className="w-3.5 h-3.5 opacity-40" />;
    const e = event.toUpperCase();
    if (e.includes("STARTED") || e.includes("START")) return <Play className="w-3.5 h-3.5 text-blue-500" />;
    if (e.includes("SUBMITTED") || e.includes("ANSWERED") || e.includes("SUCCESS")) return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    if (e.includes("REQUESTED") || e.includes("REQUEST")) return <Send className="w-3.5 h-3.5 text-accent" />;
    if (e.includes("ERROR") || e.includes("FAILED")) return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    return <Terminal className="w-3.5 h-3.5 opacity-40" />;
};

const getEventSummary = (item) => {
    const mainText = item.question || item.answer || item.prompt || item.error || item.status || item.message;
    const subText = item.slug || (item.event && item.event.startsWith("WORKFLOW_") ? item.event.replace("WORKFLOW_", "") : null);

    if (!mainText && !subText) return item.event || "Unknown Event";

    return (
        <div className="flex flex-col gap-0.5">
            {subText && <span className="text-accent font-medium text-[10px] tracking-wider uppercase opacity-80">{subText}</span>}
            {mainText && (
                <span className="opacity-80 truncate max-w-md">
                    {typeof mainText === "string" ? mainText : JSON.stringify(mainText)}
                </span>
            )}
        </div>
    );
};

export default function EventsLog({ history, onJump }) {
    return (
        <div className="w-full h-full flex flex-col overflow-hidden bg-bg">
            <div className="flex-1 overflow-y-auto custom-scroll px-6 py-24">
                <div className="max-w-4xl mx-auto space-y-1">
                    {history.length === 0 ? (
                        <div className="h-[40vh] flex flex-col items-center justify-center opacity-20 space-y-4">
                            <Terminal className="w-12 h-12" />
                            <div className="text-xs font-bold tracking-[0.4em] uppercase">No events yet</div>
                        </div>
                    ) : (
                        history.map((item, idx) => {
                            const time = new Date(item.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false
                            });

                            return (
                                <button
                                    key={idx}
                                    onClick={() => onJump(idx)}
                                    className="w-full text-left group flex items-start gap-6 p-4 rounded-2xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-all border border-transparent hover:border-border"
                                >
                                    <div className="flex-shrink-0 w-20 pt-1">
                                        <span className="text-[10px] font-mono font-medium opacity-20 group-hover:opacity-40 transition-opacity">
                                            {time}
                                        </span>
                                    </div>

                                    <div className="flex-shrink-0 pt-0.5">
                                        {getEventIcon(item.event)}
                                    </div>

                                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                                        <div className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-30 group-hover:opacity-50 transition-opacity">
                                            {item.event?.replace(/_/g, " ") || "EVENT"}
                                        </div>
                                        <div className="text-sm leading-relaxed truncate group-hover:text-accent transition-colors">
                                            {getEventSummary(item)}
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
