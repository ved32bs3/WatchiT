"use client";

import { useEffect, useState } from "react";

const blankOptions = ["", ""];

export default function PartyPollPanel({ isHost, socket, socketStatus }) {
  const [poll, setPoll] = useState(null);
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(blankOptions);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!socket) return undefined;
    const handlePollState = (next) => {
      setPoll((current) => next.id === current?.id
        ? { ...next, myVote: current.myVote }
        : next);
    };
    socket.on("party:poll-state", handlePollState);
    return () => socket.off("party:poll-state", handlePollState);
  }, [socket]);

  function submitPoll(event) {
    event.preventDefault();
    if (!socket?.connected || socketStatus !== "connected" || isBusy) return;
    setError("");
    setIsBusy(true);
    socket.timeout(8000).emit("party:poll-create", { title, options }, (timeoutError, result) => {
      setIsBusy(false);
      if (timeoutError || !result?.ok) {
        setError(result?.error || "Could not create the poll.");
        return;
      }
      setPoll(result.poll);
      setTitle("");
      setOptions(blankOptions);
    });
  }

  function vote(optionId) {
    if (!poll || poll.myVote || !poll.isOpen || !socket?.connected || isBusy) return;
    setError("");
    setIsBusy(true);
    socket.timeout(8000).emit("party:poll-vote", { pollId: poll.id, optionId }, (timeoutError, result) => {
      setIsBusy(false);
      if (timeoutError || !result?.ok) {
        setError(result?.error || "Your vote could not be submitted.");
        return;
      }
      setPoll(result.poll);
    });
  }

  function closePoll() {
    if (!poll || !poll.isOpen || !socket?.connected || isBusy) return;
    setError("");
    setIsBusy(true);
    socket.timeout(8000).emit("party:poll-close", { pollId: poll.id }, (timeoutError, result) => {
      setIsBusy(false);
      if (timeoutError || !result?.ok) {
        setError(result?.error || "Could not close the poll.");
        return;
      }
      setPoll(result.poll);
    });
  }

  const totalVotes = poll?.options.reduce((sum, option) => sum + option.votes, 0) ?? 0;

  return (
    <section aria-labelledby="poll-title" className="mt-8 rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Live room poll</p>
          <h2 id="poll-title" className="mt-2 text-xl font-semibold">Choose together</h2>
          <p className="mt-1 text-sm text-zinc-400">Each party member, including the host, can vote once. Polls are saved with the party chat.</p>
        </div>
        {poll && <span className={`rounded-full px-3 py-1 text-xs ${poll.isOpen ? "bg-emerald-400/10 text-emerald-200" : "bg-white/10 text-zinc-300"}`}>{poll.isOpen ? "Open" : "Closed"}</span>}
      </div>

      {poll && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-white">{poll.title}</h3>
            <span className="text-xs text-zinc-500">{totalVotes} {totalVotes === 1 ? "vote" : "votes"}</span>
          </div>
          <ul className="mt-3 space-y-2">
            {poll.options.map((option) => {
              const percent = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => vote(option.id)}
                    disabled={!poll.isOpen || Boolean(poll.myVote) || isBusy || socketStatus !== "connected"}
                    className={`relative min-h-11 w-full cursor-pointer overflow-hidden rounded-lg border px-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${poll.myVote === option.id ? "border-rose-400/40" : "border-white/[0.08]"} disabled:cursor-not-allowed`}
                    aria-pressed={poll.myVote === option.id}
                  >
                    <span className="absolute inset-y-0 left-0 bg-rose-400/15 transition-[width] duration-500" style={{ width: `${percent}%` }} />
                    <span className="relative flex items-center justify-between gap-3 py-2 text-zinc-100">
                      <span>{option.text}{poll.myVote === option.id && <span className="ml-2 text-xs text-rose-200">Your vote</span>}</span>
                      <span className="shrink-0 text-xs text-zinc-300">{option.votes} · {percent}%</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {poll.isOpen && !poll.myVote && <p className="mt-2 text-xs text-zinc-500">Choose one option. You can only vote once.</p>}
          {isHost && poll.isOpen && <button type="button" onClick={closePoll} disabled={isBusy || socketStatus !== "connected"} className="mt-4 min-h-10 cursor-pointer rounded-lg border border-rose-400/25 px-4 text-sm font-medium text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-40">{isBusy ? "Updating…" : "Close poll"}</button>}
        </div>
      )}

      {isHost && (!poll || !poll.isOpen) && (
        <form onSubmit={submitPoll} className="mt-5 border-t border-white/10 pt-5">
          <label htmlFor="poll-question" className="text-sm font-medium text-zinc-200">Poll question</label>
          <input id="poll-question" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="What should we watch next?" className="mt-2 min-h-11 w-full rounded-lg border border-white/[0.08] bg-zinc-950/70 px-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-rose-300/50" />
          <div className="mt-3 space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <label htmlFor={`poll-option-${index}`} className="sr-only">Poll option {index + 1}</label>
                <input id={`poll-option-${index}`} value={option} maxLength={80} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Option ${index + 1}`} className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-950/70 px-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-rose-400" />
                {options.length > 2 && <button type="button" aria-label={`Remove option ${index + 1}`} onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="cursor-pointer rounded-lg px-3 text-sm text-zinc-400 hover:bg-white/[0.06]">Remove</button>}
              </div>
            ))}
          </div>
          {options.length < 6 && <button type="button" onClick={() => setOptions((current) => [...current, ""])} className="mt-3 cursor-pointer text-xs font-medium text-rose-300 underline underline-offset-2">Add option</button>}
          <button type="submit" disabled={!title.trim() || isBusy || socketStatus !== "connected"} className="mt-4 block min-h-10 cursor-pointer rounded-lg bg-rose-500 px-4 text-sm font-semibold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40">{isBusy ? "Creating…" : "Create poll"}</button>
        </form>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
    </section>
  );
}
