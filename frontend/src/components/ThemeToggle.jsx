import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains("dark")
  );

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
      className={dark ? "px-3 py-1 rounded bg-background-900 text-dark-text" : "px-3 py-1 rounded bg-background-50 text-text-900"}
    >
      <img
        src={dark ? "src/assets/image.png" : "src/assets/night-mode.png"}
        className="w-6 h-6"
      />
    </button>
  );
}
