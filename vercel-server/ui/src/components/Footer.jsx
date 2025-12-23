import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Footer({ page, total, onNext, onPrev, onJump, hasNew, onJumpToLatest, className = "" }) {
  const [inputValue, setInputValue] = useState(page + 1);
  useEffect(() => setInputValue(page + 1), [page]);

  const handleInputChange = (event) => {
    const { value } = event.target;
    setInputValue(value);
    const num = parseInt(value, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= total) {
      onJump(num - 1);
    }
  };

  return (
    <footer className={`nav-footer transition-opacity duration-300 ${className}`}>
      <div className="footer-control">
        <button
          onClick={onPrev}
          disabled={page === 0}
          className="tooltip p-1 hover:text-accent disabled:opacity-0 transition-all pointer-events-auto"
          data-tooltip="Previous"
          aria-label="Previous event"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-widest opacity-60">
          <input
            type="number"
            value={inputValue}
            onChange={handleInputChange}
            className="jumper-input"
            min="1"
            max={total}
          />
          <span className="opacity-20">/</span>
          <span>{total}</span>
        </div>

        <button
          onClick={onNext}
          disabled={page === total - 1}
          className="tooltip p-1 hover:text-accent disabled:opacity-0 transition-all pointer-events-auto"
          data-tooltip="Next"
          aria-label="Next event"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {hasNew ? (
          <button
            onClick={onJumpToLatest}
            className="tooltip px-3 py-1 rounded-full text-[10px] font-bold tracking-[0.2em] uppercase bg-accent text-white shadow-[0_10px_30px_rgba(0,122,255,0.25)] hover:scale-[1.02] transition-transform"
            data-tooltip="Latest"
            aria-label="Jump to latest event"
          >
            New
          </button>
        ) : null}
      </div>
    </footer>
  );
}
