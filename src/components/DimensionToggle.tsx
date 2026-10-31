import { Ruler } from "lucide-react";
import { t, useLocale } from "../lib/i18n";

type Props = {
  visible: boolean;
  onChange: (visible: boolean) => void;
  disabled: boolean;
};

export default function DimensionToggle({
  visible,
  onChange,
  disabled,
}: Props) {
  useLocale();
  return (
    <button
      className={`icon-button ${visible ? "active" : ""}`}
      aria-label={t("Dimensions")}
      title={t("Dimensions")}
      aria-pressed={visible}
      disabled={disabled}
      onClick={() => onChange(!visible)}
    >
      <Ruler size={17} />
    </button>
  );
}
