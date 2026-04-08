import { useState, useRef, useCallback } from "react";

export function useDebounceSearch(
  initialValue: string,
  onSearch: (value: string) => void,
  delay = 400,
) {
  const [searchInput, setSearchInput] = useState(initialValue);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => onSearch(value), delay);
    },
    [onSearch, delay],
  );

  const clearSearch = useCallback(() => {
    setSearchInput("");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onSearch("");
  }, [onSearch]);

  return { searchInput, setSearchInput, handleSearchChange, clearSearch };
}
