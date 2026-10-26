"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { errorText } from "@/lib/session";
import { useToast } from "../Toasts";

const REASONS = [
  ["copy", "It copies another coin"],
  ["scam", "It's a scam"],
  ["nsfw", "Not safe for work"],
  ["illegal", "Illegal content"],
  ["other", "Something else"],
] as const;

/** "Report" on a coin page: sends a reason to the moderation queue (/admin). No sign-in needed. */
export function ReportButton({ mint, ticker }: { mint: string; ticker: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("copy");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/coins/${mint}/report`, { method: "POST", body: JSON.stringify({ reason, details: details.trim() }) });
      toast("Thanks. We'll take a look.");
      setOpen(false);
      setDetails("");
    } catch (err) {
      const m = errorText(err, "The report didn't go through. Try again.");
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="tag report" type="button" onClick={() => setOpen(true)}>Report</button>
      {open && (
        <div className="modal-bg on" role="dialog" aria-modal="true" aria-labelledby="reportTitle" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal report-modal" onSubmit={submit}>
            <div className="in">
              <h2 id="reportTitle">Report ${ticker}</h2>
              <p>Tell us what&apos;s wrong. Reports go to Divvy&apos;s moderators.</p>
              <div className="report-reasons" role="radiogroup" aria-label="Reason">
                {REASONS.map(([k, label]) => (
                  <label key={k} className="report-reason">
                    <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
                    {label}
                  </label>
                ))}
              </div>
              <textarea className="tinput" rows={3} maxLength={500} placeholder="Details, links (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
              <div className="report-acts">
                <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn btn-g" type="submit" disabled={busy}>Send report</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
