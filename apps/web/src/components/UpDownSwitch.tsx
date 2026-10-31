"use client";

import { useMsgs, useUpDown } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";

/** Green up / red up. Chinese stock apps show gains in red; crypto apps mostly in green. Kept in a cookie. */
export function UpDownSwitch() {
  const [upDown, setUpDown] = useUpDown();
  const t = useMsgs(common);
  return (
    <div className="updown-switch" role="group" aria-label={t.upDown}>
      <span>{t.upDown}</span>
      <div className="seg">
        <button type="button" aria-pressed={upDown === "intl"} onClick={() => setUpDown("intl")}>{t.upDownIntl}</button>
        <button type="button" aria-pressed={upDown === "cn"} onClick={() => setUpDown("cn")}>{t.upDownCn}</button>
      </div>
    </div>
  );
}
