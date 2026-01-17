"use client";

import { useEffect, useState } from "react";

type LogoProps = {
  className?: string;
  width?: number;
  height?: number;
  forcedColor?: "light" | "dark";
};

export default function Logo({ className, width = 300, height = 300, forcedColor }: LogoProps) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  let color = "currentColor"; // default behavior
  if (forcedColor === "light") color = "#F4F5F7";
  if (forcedColor === "dark") color = "#1a1a1a";


  useEffect(() => {
    // Get the initial theme from the document
    const current = document.documentElement.getAttribute("color-scheme") as "light" | "dark";
    setTheme(current || "light");

    // Listen for theme changes from the ThemeSwitcher
    const handleThemeChange = (e: CustomEvent) => setTheme(e.detail);
    document.addEventListener("color-scheme-change", handleThemeChange as EventListener);

    return () => {
      document.removeEventListener("color-scheme-change", handleThemeChange as EventListener);
    };
  }, []);

  const src = theme === "dark" ? "/img/icons/Ascend2.svg" : "/img/icons/Ascend.svg";

  return (
  <svg
    width={width}
    height={height}
    viewBox="0 0 300 300"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="Ascend Web Solutions"
  >
    {/* Wings */}
    <path
      d="M82.963 140.125L0 300H87.037L111.111 253.918V140.125H82.963Z"
      fill="currentColor"
    />
    <path
      d="M188.148 140.125H216.296L300 300H212.963L188.148 254.859V140.125Z"
      fill="currentColor"
    />

    {/* Core mark */}
    <path
      d="M173.333 280.251H125.926V105.329H94.0741L149.63 0L205.926 105.329H173.333V280.251Z"
      fill="#006B40"
    />
  </svg>
);
}