import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      className={dark ? "px-3 py-1 rounded bg-background-900 text-dark-text border border-transparent hover:border-gray-50" : "px-3 py-1 rounded bg-background-50 text-text-900 border border-transparent hover:border-gray-900"}
    >
      {dark ? "☀️ Light" : "🌙 Dark"}
    </button>
  );
}
