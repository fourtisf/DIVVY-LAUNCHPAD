"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useErrorText } from "@/lib/session";
import { useMsgs } from "@/i18n/client";
import { reportMsgs } from "@/i18n/msgs/coin";
import { useToast } from "../Toasts";

const REASONS = ["copy", "scam", "nsfw", "illegal", "other"] as const;

/** "Report" on a coin page: sends a reason to the moderation queue (/admin). No sign-in needed. */
export function ReportButton({ mint, ticker }: { mint: string; ticker: string }) {
  const toast = useToast();
  const t = useMsgs(reportMsgs);
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("copy");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  // Escape closes it, focus moves into it while it's open and back to "Report" after.
  useEffect(() => {
    if (!open) return;
    const button = opener.current;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      button?.focus();
    };
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/coins/${mint}/report`, { method: "POST", body: JSON.stringify({ reason, details: details.trim() }) });
      toast(t.thanks);
      setOpen(false);
      setDetails("");
    } catch (err) {
      const m = errorText(err, t.failed);
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button ref={opener} className="tag report" type="button" onClick={() => setOpen(true)}>{t.report}</button>
      {open && (
        <div className="modal-bg on" role="dialog" aria-modal="true" aria-labelledby="reportTitle" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal report-modal" onSubmit={submit}>
            <div className="in">
              <h2 id="reportTitle">{t.title(ticker)}</h2>
              <p>{t.intro}</p>
              <div className="report-reasons" role="radiogroup" aria-label={t.reason}>
                {REASONS.map((k, i) => (
                  <label key={k} className="report-reason">
                    <input ref={i === 0 ? first : undefined} type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
                    {t.reasons[k]}
                  </label>
                ))}
              </div>
              <textarea className="tinput" rows={3} maxLength={500} placeholder={t.details} value={details} onChange={(e) => setDetails(e.target.value)} />
              <div className="report-acts">
                <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>{t.cancel}</button>
                <button className="btn btn-g" type="submit" disabled={busy}>{t.send}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
