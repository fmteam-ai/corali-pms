"use client";
import { useState } from "react";
import { LuMoon, LuSun } from "react-icons/lu";

/** Light / dark PMS theme, remembered per browser in the corali_pms_theme cookie (read by the layout, so no flash). */
export function ThemeToggle({ initial, labels }: { initial: "light" | "dark"; labels: { light: string; dark: string } }) {
  const [theme, setTheme] = useState(initial);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.cookie = `corali_pms_theme=${next}; path=/; max-age=31536000; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`;
    document.querySelector(".pms")?.setAttribute("data-theme", next);
  }
  const label = theme === "dark" ? labels.light : labels.dark;
  return <button type="button" className="themeToggle" aria-label={label} title={label} onClick={toggle}>{theme === "dark" ? <LuSun aria-hidden /> : <LuMoon aria-hidden />}</button>;
}
