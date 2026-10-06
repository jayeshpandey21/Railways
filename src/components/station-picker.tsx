"use client";

import { useEffect, useState } from "react";

export type StationOption = { code: string; name: string; state?: string };

type StationPickerProps = {
  id: string;
  label: string;
  station: StationOption | null;
  placeholder: string;
  onSelect: (station: StationOption | null) => void;
};

export function StationPicker({
  id,
  label,
  station,
  placeholder,
  onSelect,
}: StationPickerProps) {
  const [query, setQuery] = useState("");
  const [stations, setStations] = useState<StationOption[]>([]);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) {
        setStations([]);
        return;
      }

      try {
        const response = await fetch(`/api/stations?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Station search failed.");
        setStations(payload.stations as StationOption[]);
        setSearchError("");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setStations([]);
        setSearchError(error instanceof Error ? error.message : "Station search failed.");
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (station: StationOption) => {
    setQuery("");
    setStations([]);
    setSearchError("");
    onSelect(station);
  };

  return (
    <div className="search-field station-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={stations.length > 0}
        aria-controls={`${id}-suggestions`}
        autoComplete="off"
        value={query || (station ? `${station.name} (${station.code})` : "")}
        onChange={(event) => {
          const nextValue = event.target.value;
          setQuery(nextValue);
          setSearchError("");
          onSelect(null);
        }}
        placeholder={placeholder}
      />
      {stations.length > 0 && (
        <ul className="station-suggestions" id={`${id}-suggestions`} role="listbox">
          {stations.map((station) => (
            <li key={station.code} role="option" aria-selected={false}>
              <button type="button" onClick={() => choose(station)}>
                <span>{station.name} <strong>{station.code}</strong></span>
                {station.state && <small>{station.state}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchError && <span className="station-search-error" role="status">{searchError}</span>}
    </div>
  );
}
