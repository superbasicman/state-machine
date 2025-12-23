import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

export default function Footer({ page, total, onNext, onPrev, onJump }) {
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
    <footer className="nav-footer">
      <div className="footer-control">
        <button
          onClick={onPrev}
          disabled={page === 0}
          className="p-1 hover:text-accent disabled:opacity-0 transition-all pointer-events-auto"
        >
          <Icon name="chevronLeft" className="w-5 h-5" />
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
          className="p-1 hover:text-accent disabled:opacity-0 transition-all pointer-events-auto"
        >
          <Icon name="chevronRight" className="w-5 h-5" />
        </button>
      </div>
    </footer>
  );
}
