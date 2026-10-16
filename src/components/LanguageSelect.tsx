import { Languages } from "lucide-react";
import { useLocale, type Locale } from "../lib/i18n";

export default function LanguageSelect() {
  const { locale, setLocale, t } = useLocale();
  return (
    <label className="language-select">
      <Languages size={16} aria-hidden="true" />
      <select
        aria-label={t("Language")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="zh-CN" lang="zh-CN">
          简体中文
        </option>
      </select>
    </label>
  );
}
