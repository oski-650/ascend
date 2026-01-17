"use client";
import { useEffect, useState } from "react";

export default function ThemeSwitcherButton() {
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [colorScheme, setColorScheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return (
        (localStorage.getItem("color-scheme") as "light" | "dark") || "light"
      );
    }
    return "light";
  });

  // Show button only after mount (avoids hydration issues)
  useEffect(() => {
    setShowSwitcher(true);
  }, []);

  // ALL side effects live here (NOT in render, NOT in click handler)
  useEffect(() => {
    document.documentElement.setAttribute("color-scheme", colorScheme);
    localStorage.setItem("color-scheme", colorScheme);

    document.dispatchEvent(
      new CustomEvent("color-scheme-change", { detail: colorScheme })
    );
  }, [colorScheme]);

  const handleColorSwitch = () => {
    setColorScheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  if (!showSwitcher) return null;

  return (
    <button
      id="color-switcher"
      className="mxd-color-switcher"
      type="button"
      role="switch"
      aria-label="light/dark mode"
      aria-checked={colorScheme === "dark"}
      onClick={handleColorSwitch}
    >
      <i
        className={
          colorScheme === "dark"
            ? "ph-bold ph-sun-horizon"
            : "ph-bold ph-moon-stars"
        }
      />
    </button>
  );
}