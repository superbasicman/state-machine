import { Moon, Sun, LayoutList, Presentation } from "lucide-react";
import CopyButton from "./CopyButton.jsx";

export default function Header({ workflowName, status, theme, toggleTheme, viewMode, setViewMode, history }) {
  return (
    <header className="fixed top-0 inset-x-0 h-20 px-12 flex items-center justify-between z-50 bg-bg/80 backdrop-blur-3xl">
      <div className="flex items-center gap-4">
        <div className={`w-2 h-2 rounded-full ${status === "connected" ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)]" : "bg-red-500"}`}></div>
        <span className="font-bold text-[10px] tracking-[0.4em] uppercase opacity-30 truncate max-w-[300px]">{workflowName || "Workflow"}</span>
      </div>

      <div className="flex items-center gap-2">
        <CopyButton text={history || []} label="Copy full history" disabled={!history || history.length === 0} />
        <button
          onClick={() => setViewMode(viewMode === "present" ? "log" : "present")}
          className="tooltip w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          data-tooltip={viewMode === "present" ? "Log view" : "Present view"}
          aria-label={viewMode === "present" ? "Switch to Log view" : "Switch to Presentation view"}
        >
          {viewMode === "present" ? (
            <LayoutList className="w-5 h-5 opacity-40 hover:opacity-100" />
          ) : (
            <Presentation className="w-5 h-5 opacity-40 hover:opacity-100" />
          )}
        </button>

      <button
        onClick={toggleTheme}
        className="tooltip w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        data-tooltip={theme === "dark" ? "Light theme" : "Dark theme"}
        aria-label={theme === "dark" ? "Switch to Light theme" : "Switch to Dark theme"}
      >
        {theme === "dark" ? <Sun className="w-5 h-5 opacity-40 hover:opacity-100" /> : <Moon className="w-5 h-5 opacity-40 hover:opacity-100" />}
      </button>
      </div>
    </header>
  );
}
