"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { COUNTRIES, countryFlag, type Country } from "@/lib/countries";
import { ChevronDown, Search } from "lucide-react";

export type CountryPhoneValue = {
  countryCode: string; // ISO-2, e.g. "NG"
  dialCode: string; // e.g. "+234"
  phoneNumber: string; // national number, digits only
};

export default function CountryPhoneInput({
  value,
  onChange,
  defaultCountryCode = "NG",
}: {
  value: CountryPhoneValue;
  onChange: (value: CountryPhoneValue) => void;
  defaultCountryCode?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selected: Country =
    COUNTRIES.find((c) => c.code === value.countryCode) ||
    COUNTRIES.find((c) => c.code === defaultCountryCode) ||
    COUNTRIES[0];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase() === q
    );
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectCountry(c: Country) {
    onChange({ ...value, countryCode: c.code, dialCode: c.dialCode });
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-gray-400">Country</label>
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white outline-none transition hover:border-white/20"
        >
          <span className="flex items-center gap-2 truncate">
            <span className="text-base leading-none">{countryFlag(selected.code)}</span>
            <span className="truncate">{selected.name}</span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-gray-400" />
        </button>

        {open && (
          <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-[#0d0620] shadow-xl">
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Search size={14} className="text-gray-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search country or dial code..."
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500">No matches.</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => selectCountry(c)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-white/5 ${
                      c.code === selected.code ? "bg-white/5" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate text-gray-100">
                      <span className="text-base leading-none">{countryFlag(c.code)}</span>
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">{c.dialCode}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <label className="block pt-2 text-xs text-gray-400">Phone number</label>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
        <span className="shrink-0 text-sm text-gray-300">{selected.dialCode}</span>
        <div className="h-4 w-px bg-white/10" />
        <input
          type="tel"
          inputMode="numeric"
          value={value.phoneNumber}
          onChange={(e) =>
            onChange({ ...value, phoneNumber: e.target.value.replace(/[^\d]/g, "") })
          }
          placeholder="801 234 5678"
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
        />
      </div>
    </div>
  );
}