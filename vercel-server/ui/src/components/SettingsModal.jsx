import { X, Square } from "lucide-react";
import { useState, useEffect } from "react";

export default function SettingsModal({
  isOpen,
  onClose,
  fullAuto,
  onToggleFullAuto,
  autoSelectDelay,
  onDelayChange,
  onStop,
  disabled,
}) {
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [localDelay, setLocalDelay] = useState(String(autoSelectDelay));

  // Sync local state when prop changes (e.g., from remote update)
  useEffect(() => {
    setLocalDelay(String(autoSelectDelay));
  }, [autoSelectDelay]);

  if (!isOpen) return null;

  const handleStop = () => {
    if (showStopConfirm) {
      onStop();
      setShowStopConfirm(false);
      onClose();
    } else {
      setShowStopConfirm(true);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      setShowStopConfirm(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-3xl p-8 w-[90vw] max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Settings</h2>
          <button
            onClick={() => {
              setShowStopConfirm(false);
              onClose();
            }}
            className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Full-auto toggle */}
        <div className="flex items-center justify-between py-4 border-b border-black/10 dark:border-white/10">
          <div>
            <div className="font-semibold">Full-Auto Mode</div>
            <div className="text-sm text-black/50 dark:text-white/50">
              Auto-select recommended options
            </div>
          </div>
          <button
            onClick={onToggleFullAuto}
            disabled={disabled}
            className={`w-12 h-7 rounded-full transition-colors relative ${
              fullAuto
                ? "bg-black dark:bg-white"
                : "bg-black/20 dark:bg-white/20"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            aria-pressed={fullAuto}
            aria-label="Toggle full-auto mode"
          >
            <div
              className={`absolute top-1 w-5 h-5 rounded-full bg-white dark:bg-black transition-transform ${
                fullAuto ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>

        {/* Countdown delay */}
        <div className="flex items-center justify-between py-4 border-b border-black/10 dark:border-white/10">
          <div>
            <div className="font-semibold">Countdown Delay</div>
            <div className="text-sm text-black/50 dark:text-white/50">
              Seconds before auto-select
            </div>
          </div>
          <input
            type="number"
            value={localDelay}
            onChange={(e) => setLocalDelay(e.target.value)}
            onBlur={() => {
              const val = parseInt(localDelay, 10);
              if (!isNaN(val) && val >= 1 && val <= 120) {
                onDelayChange(val);
              } else {
                // Reset to current valid value if invalid
                setLocalDelay(String(autoSelectDelay));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.target.blur();
              }
            }}
            min={1}
            max={120}
            disabled={disabled}
            className="w-20 p-2 text-center rounded-xl border border-black/20 dark:border-white/20 bg-transparent disabled:opacity-50"
          />
        </div>

        {/* Stop button */}
        <div className="mt-6">
          <button
            onClick={handleStop}
            disabled={disabled}
            className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors ${
              showStopConfirm
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Square className="w-5 h-5" />
            {showStopConfirm ? "Click again to confirm" : "Stop Workflow"}
          </button>
          {showStopConfirm && (
            <div className="text-center text-sm text-black/50 dark:text-white/50 mt-2">
              This will terminate the CLI process
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
