import React, { useState, useEffect, useRef } from "react";
import { SearchableOption } from "../types";
import { ChevronDown, X, Check, Search } from "./icons";

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onEnterNext?: () => void;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  className = "",
  onEnterNext,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value.toString() === value.toString());

  const filteredOptions = options.filter((o) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      o.label.toLowerCase().includes(term) ||
      (o.subLabel && o.subLabel.toLowerCase().includes(term)) ||
      (o.badge && o.badge.toLowerCase().includes(term))
    );
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(0);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 40);
    } else {
      setSearchTerm("");
    }
  }, [isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    if (onEnterNext) {
      setTimeout(onEnterNext, 40);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < filteredOptions.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredOptions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredOptions.length > 0 && highlightedIndex < filteredOptions.length) {
        handleSelect(filteredOptions[highlightedIndex].value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className={`w-full min-h-[44px] px-3.5 py-2 bg-white border rounded-lg text-sm flex items-center justify-between cursor-pointer transition-colors ${
          disabled
            ? "bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200"
            : "hover:border-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
        } ${isOpen ? "border-emerald-600 ring-1 ring-emerald-600" : "border-slate-300"}`}
      >
        <div className="flex-1 truncate">
          {selectedOption ? (
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900">{selectedOption.label}</span>
              {selectedOption.badge && (
                <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
                  {selectedOption.badge}
                </span>
              )}
              {selectedOption.subLabel && (
                <span className="text-xs text-slate-400 truncate">({selectedOption.subLabel})</span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 text-sm">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          {selectedOption && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
              title="Clear"
            >
              <X size={13} />
            </button>
          )}
          <ChevronDown size={14} className="text-slate-400 pointer-events-none" />
        </div>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="खोजें / Search..."
              className="w-full bg-transparent text-sm focus:outline-none text-slate-800"
            />
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400">
                कोई परिणाम नहीं मिला
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value.toString() === value.toString();
                const isHighlighted = idx === highlightedIndex;
                return (
                  <div
                    key={opt.value}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`px-3.5 py-2.5 cursor-pointer text-sm flex items-center justify-between transition-colors ${
                      isHighlighted
                        ? "bg-slate-50 text-slate-900"
                        : "text-slate-700 hover:bg-slate-50"
                    } ${isSelected ? "bg-emerald-50 text-emerald-800 font-medium" : ""}`}
                  >
                    <div className="truncate pr-2">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{opt.label}</span>
                        {opt.badge && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      {opt.subLabel && (
                        <div className="text-xs text-slate-400 truncate mt-0.5">{opt.subLabel}</div>
                      )}
                    </div>
                    {isSelected && <Check size={14} className="text-emerald-600 flex-shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
