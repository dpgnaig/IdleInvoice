import { useEffect, useState } from 'react';

/** Trả giá trị sau khi người dùng ngừng gõ `delay` ms (mặc định 300ms). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
