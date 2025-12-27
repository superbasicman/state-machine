import { Moon, Sun, LayoutList, Presentation, Play, Pause, Settings } from "lucide-react";
import CopyButton from "./CopyButton.jsx";

export default function Header({
  workflowName,
  status,
  theme,
  toggleTheme,
  viewMode,
  setViewMode,
  history,
  fullAuto,
  onToggleFullAuto,
  onOpenSettings,
  configDisabled,
}) {
  const isConnected = status === "connected";

  return (
    <header className="fixed top-0 inset-x-0 h-20 px-6 sm:px-10 lg:px-12 flex items-center justify-between z-50 bg-bg/80 backdrop-blur-3xl">
      <div className="flex items-center gap-4">
        <div
          className={`w-2.5 h-2.5 rounded-full border ${
            isConnected
              ? "bg-black border-black dark:bg-white dark:border-white"
              : "bg-transparent border-black/30 dark:border-white/30"
          }`}
          aria-hidden="true"
        />
        <span className="font-semibold text-[10px] tracking-[0.32em] uppercase text-black/50 dark:text-white/50 truncate max-w-[300px]">
          {workflowName || "Workflow"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Play/Pause button - quick toggle for full-auto */}
        <button
          onClick={onToggleFullAuto}
          disabled={configDisabled}
          className={`tooltip w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
            configDisabled
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-black/5 dark:hover:bg-white/10"
          }`}
          data-tooltip={fullAuto ? "Pause auto" : "Enable auto"}
          aria-label={fullAuto ? "Disable full-auto mode" : "Enable full-auto mode"}
        >
          {fullAuto ? (
            <Pause className="w-5 h-5 opacity-60" />
          ) : (
            <Play className="w-5 h-5 opacity-40 hover:opacity-100" />
          )}
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="tooltip w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          data-tooltip="Settings"
          aria-label="Open settings"
        >
          <Settings className="w-5 h-5 opacity-40 hover:opacity-100" />
        </button>

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
          {theme === "dark" ? (
            <Sun className="w-5 h-5 opacity-40 hover:opacity-100" />
          ) : (
            <Moon className="w-5 h-5 opacity-40 hover:opacity-100" />
          )}
        </button>
      </div>
    </header>
  );
}
