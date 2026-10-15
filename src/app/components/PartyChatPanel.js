"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatRequest } from "@/app/lib/partyApi";

function normalizeMessage(message) {
  const id = String(message?._id ?? message?.id ?? "");
  return {
    id,
    name: String(message?.name ?? "Guest"),
    msg: String(message?.msg ?? ""),
    timestamp: message?.timestamp ?? new Date().toISOString(),
  };
}

function appendUnique(current, incoming) {
  const known = new Set(current.map((message) => message.id));
  const additions = incoming.map(normalizeMessage).filter((message) => message.id && !known.has(message.id));
  if (!additions.length) return current;
  return [...current, ...additions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Chat is unavailable.");
  return data;
}

export default function PartyChatPanel({ partyCode, participantName, socket, socketStatus }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const bottomRef = useRef(null);
  const formRef = useRef(null);

  const loadHistory = useCallback(async (signal) => {
    try {
      const response = await chatRequest(partyCode, { cache: "no-store", signal });
      const data = await readResponse(response);
      setMessages((current) => appendUnique(current, data.messages ?? []));
      setError("");
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError.message || "Could not load chat history.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [partyCode]);

  useEffect(() => {
    const controller = new AbortController();
    const initialLoadTimer = window.setTimeout(() => loadHistory(controller.signal), 0);
    const refreshTimer = window.setInterval(() => loadHistory(), 5000);

    const handleSocketMessage = (message) => {
      setMessages((current) => appendUnique(current, [message]));
    };
    const handleReconnect = () => loadHistory();
    socket?.on("party:chat-message", handleSocketMessage);
    socket?.on("connect", handleReconnect);

    return () => {
      controller.abort();
      window.clearTimeout(initialLoadTimer);
      window.clearInterval(refreshTimer);
      socket?.off("party:chat-message", handleSocketMessage);
      socket?.off("connect", handleReconnect);
    };
  }, [loadHistory, socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function handleSend(event) {
    event.preventDefault();
    const msg = draft.trim();
    if (!msg || msg.length > 1000 || isSending) return;

    setIsSending(true);
    setError("");
    try {
      // Persist first through REST; only accepted, stored messages are relayed by Socket.IO.
      const response = await chatRequest(partyCode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: participantName, msg }),
      });
      const data = await readResponse(response);
      const savedMessage = normalizeMessage(data.message);
      setMessages((current) => appendUnique(current, [savedMessage]));
      setDraft("");

      if (socket?.connected) {
        socket.emit("party:chat-message", savedMessage, (result) => {
          if (!result?.ok) setError("Message saved, but live delivery failed. Others will see it after reconnecting.");
        });
      }
    } catch (sendError) {
      setError(sendError.message || "Could not send this message.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <aside aria-label="Party chat" className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] lg:h-[min(70vw,680px)] lg:min-h-[520px]">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-4">
        <div>
          <h2 className="text-base font-semibold text-white">Party chat</h2>
          <p className="mt-1 text-xs text-zinc-500">Messages are saved for this party.</p>
        </div>
        <span aria-label={socketStatus === "connected" ? "Live chat connected" : "Chat will sync when reconnected"} className={`size-2.5 rounded-full ${socketStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
      </header>

      <div role="log" aria-live="polite" aria-relevant="additions" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {isLoading && messages.length === 0 && <p className="text-center text-sm text-zinc-500">Loading chat...</p>}
        {!isLoading && messages.length === 0 && <p className="py-8 text-center text-sm leading-6 text-zinc-500">No messages yet. Say hello to the party.</p>}
        {messages.map((message) => {
          const isOwnMessage = message.name === participantName;
          const messageTime = new Date(message.timestamp);
          return (
            <article key={message.id} className={`max-w-[92%] rounded-2xl px-3 py-2.5 ${isOwnMessage ? "ml-auto bg-rose-500/15" : "mr-auto bg-white/[0.06]"}`}>
              <div className="flex items-baseline justify-between gap-4">
                <p className={`truncate text-xs font-semibold ${isOwnMessage ? "text-rose-200" : "text-zinc-200"}`}>{message.name}</p>
                <time className="shrink-0 text-[10px] text-zinc-500" dateTime={messageTime.toISOString()}>
                  {Number.isNaN(messageTime.getTime()) ? "" : messageTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-zinc-100">{message.msg}</p>
            </article>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <p role="alert" className="mx-3 mb-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs leading-5 text-rose-200">{error}</p>}

      <form ref={formRef} onSubmit={handleSend} className="border-t border-white/10 p-3">
        <label htmlFor={`chat-message-${partyCode}`} className="sr-only">Write a chat message</label>
        <textarea
          id={`chat-message-${partyCode}`}
          value={draft}
          maxLength={1000}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          placeholder="Write a message..."
          className="min-h-16 w-full resize-none rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-500">Enter to send · Shift+Enter for a new line</span>
          <button
            type="submit"
            disabled={!draft.trim() || isSending}
            className="min-h-9 rounded-lg bg-rose-500 px-4 text-xs font-semibold text-white transition hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
}
