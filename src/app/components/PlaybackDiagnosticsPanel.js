"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getPlaybackDiagnostics,
  PLAYBACK_DIAGNOSTIC_EVENT_NAME,
  summarizeLatencies,
} from "@/app/lib/playback-diagnostics.mjs";

function Metric({ label, value, detail }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-sm text-white">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-zinc-500">{detail}</p>}
    </div>
  );
}

function latencyDetail(summary) {
  if (!summary?.sampleCount) return "0 samples";
  return `n=${summary.sampleCount} · p50 ${summary.p50Ms.toFixed(1)} ms · max ${summary.maxMs.toFixed(1)} ms`;
}

export default function PlaybackDiagnosticsPanel({ roomId, participantId, socket }) {
  const [isOpen, setIsOpen] = useState(false);
  const [localEvents, setLocalEvents] = useState(() => getPlaybackDiagnostics().filter((event) => event.roomId === roomId));
  const [roomDiagnostics, setRoomDiagnostics] = useState(null);

  useEffect(() => {
    const onLocalDiagnostic = (event) => {
      if (event.detail?.roomId === roomId) setLocalEvents(getPlaybackDiagnostics().filter((item) => item.roomId === roomId));
    };
    const onRoomDiagnostics = (diagnostics) => setRoomDiagnostics(diagnostics);
    window.addEventListener(PLAYBACK_DIAGNOSTIC_EVENT_NAME, onLocalDiagnostic);
    socket?.on("party:diagnostics-state", onRoomDiagnostics);
    return () => {
      window.removeEventListener(PLAYBACK_DIAGNOSTIC_EVENT_NAME, onLocalDiagnostic);
      socket?.off("party:diagnostics-state", onRoomDiagnostics);
    };
  }, [roomId, socket]);

  const report = useMemo(() => {
    const delivery = localEvents
      .filter((event) => event.type === "command-processed" && event.commandSource !== "heartbeat" && event.clockUncertaintyMs <= 250 && Number.isFinite(event.serverToClientMs))
      .map((event) => event.serverToClientMs);
    const endToEnd = localEvents
      .filter((event) => event.type === "command-processed" && event.clockUncertaintyMs <= 250 && Number.isFinite(event.endToEndMs) && event.commandSource !== "heartbeat")
      .map((event) => event.endToEndMs);
    const allSamples = localEvents.filter((event) => event.type === "player-sample");
    const samples = allSamples.filter((event) => event.status === "ready" && Number.isFinite(event.driftSeconds) &&
      Number.isFinite(event.observedTimingJitterMs) && event.clockUncertaintyMs + event.observedTimingJitterMs <= 250);
    const timingJitter = samples.map((event) => event.observedTimingJitterMs).filter(Number.isFinite);
    const corrections = localEvents.filter((event) => event.type === "correction-attempt");
    const settled = localEvents.filter((event) => event.type === "correction-settled" && Number.isFinite(event.driftSeconds) && Number.isFinite(event.correctionDurationMs));
    const correctionFailures = localEvents.filter((event) => event.type === "correction-failed");
    const failures = localEvents.filter((event) => event.type === "measurement-failure");
    const clockSync = [...localEvents].reverse().find((event) => event.type === "clock-sync");
    return {
      serverToClient: summarizeLatencies(delivery),
      endToEnd: summarizeLatencies(endToEnd),
      sampleCount: samples.length,
      nonReadySampleCount: allSamples.length - samples.length,
      maxObservedLocalDriftSeconds: samples.length ? Math.max(...samples.map((event) => Math.abs(event.driftSeconds))) : null,
      maxObservedTimingJitterMs: timingJitter.length ? Math.max(...timingJitter) : null,
      correctionAttempts: corrections.length,
      maxPreCorrectionDriftSeconds: corrections.length ? Math.max(...corrections.map((event) => Math.abs(event.driftSeconds)).filter(Number.isFinite)) : null,
      settledCorrections: settled.length,
      correctionFailures: correctionFailures.length,
      correctionDurationsMs: settled.map((event) => event.correctionDurationMs).filter(Number.isFinite),
      postCorrectionDriftsSeconds: settled.map((event) => Math.abs(event.driftSeconds)).filter(Number.isFinite),
      measurementFailures: failures.length,
      clockUncertaintyMs: clockSync?.uncertaintyMs ?? null,
    };
  }, [localEvents]);

  function exportReport() {
    const blob = new Blob([JSON.stringify({
      generatedAt: new Date().toISOString(),
      roomId,
      participantId,
      local: report,
      room: roomDiagnostics,
      localEvents,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `watchit-playback-diagnostics-${roomId}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="fixed bottom-4 right-4 z-[60] max-w-[min(94vw,620px)] text-white">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="ml-auto block rounded-lg border border-cyan-300/30 bg-zinc-950/95 px-3 py-2 text-xs font-medium text-cyan-100 shadow-lg hover:bg-zinc-900"
      >
        {isOpen ? "Hide playback diagnostics" : "Playback diagnostics"}
      </button>
      {isOpen && (
        <section aria-label="Playback diagnostics report" className="mt-2 max-h-[75vh] overflow-auto rounded-xl border border-cyan-300/20 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Playback diagnostics · room {roomId}</h2>
              <p className="mt-1 text-[11px] text-zinc-500">Actual iframe samples only. Estimates include clock-offset uncertainty.</p>
            </div>
            <button type="button" onClick={exportReport} className="rounded-md border border-white/15 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06]">Export JSON</button>
          </header>

          <p className="mt-4 text-xs font-semibold text-cyan-100">This client · {participantId || "session unavailable"}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric label="Server → client p95" value={report.serverToClient.p95Ms === null ? "—" : `${report.serverToClient.p95Ms.toFixed(1)} ms`} detail={latencyDetail(report.serverToClient)} />
            <Metric label="Host send → client p95" value={report.endToEnd.p95Ms === null ? "—" : `${report.endToEnd.p95Ms.toFixed(1)} ms`} detail={latencyDetail(report.endToEnd)} />
            <Metric label="Actual drift samples" value={String(report.sampleCount)} detail={`${report.nonReadySampleCount} buffering / unavailable${report.maxObservedLocalDriftSeconds === null ? "" : ` · max ${report.maxObservedLocalDriftSeconds.toFixed(3)} s`}`} />
            <Metric label="Pre-correction drift" value={report.maxPreCorrectionDriftSeconds === null ? "—" : `${report.maxPreCorrectionDriftSeconds.toFixed(3)} s max`} detail={`${report.correctionAttempts} attempts`} />
            <Metric label="Clock offset uncertainty" value={report.clockUncertaintyMs === null ? "—" : `±${report.clockUncertaintyMs.toFixed(1)} ms`} detail="lowest round-trip sample" />
            <Metric label="Observed player timing jitter" value={report.maxObservedTimingJitterMs === null ? "—" : `${report.maxObservedTimingJitterMs.toFixed(1)} ms max`} detail="inter-sample residual while playing" />
            <Metric label="Corrections" value={`${report.settledCorrections} / ${report.correctionAttempts}`} detail="settled / attempted" />
            <Metric label="Correction failures" value={String(report.correctionFailures)} detail="retry limit reached" />
            <Metric label="Correction time" value={report.correctionDurationsMs.length ? `${Math.max(...report.correctionDurationsMs).toFixed(0)} ms max` : "—"} detail={report.correctionDurationsMs.length ? `${report.correctionDurationsMs.length} settled` : "No settled correction"} />
            <Metric label="Post-correction player drift" value={report.postCorrectionDriftsSeconds.length ? `${Math.max(...report.postCorrectionDriftsSeconds).toFixed(3)} s max` : "—"} detail={`${report.postCorrectionDriftsSeconds.length} valid settled measurements · ${report.measurementFailures} measurement failures`} />
          </div>

          <p className="mt-4 text-xs font-semibold text-cyan-100">Room · actual synchronized samples</p>
          {roomDiagnostics ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Pairwise drift" value={roomDiagnostics.pairwise?.maxPair ? `${roomDiagnostics.pairwise.maxPair.driftSeconds.toFixed(3)} s` : "—"} detail={roomDiagnostics.pairwise?.maxPair ? `±${roomDiagnostics.pairwise.maxPair.timingUncertaintyMs.toFixed(1)} ms · ${roomDiagnostics.pairwise.status}` : (roomDiagnostics.pairwise?.status || "waiting")} />
              <Metric label="Ready clients" value={String(roomDiagnostics.pairwise?.readySampleCount ?? 0)} detail={`${roomDiagnostics.pairwise?.candidateSampleCount ?? 0} candidates · ${roomDiagnostics.pairwise?.timingPrecisionRejectedCount ?? 0} precision rejects · ${roomDiagnostics.generatedAt ? new Date(roomDiagnostics.generatedAt).toLocaleTimeString() : "—"}`} />
              <Metric label="Server → client p95" value={roomDiagnostics.serverToClient?.p95Ms === null || roomDiagnostics.serverToClient?.p95Ms === undefined ? "—" : `${roomDiagnostics.serverToClient.p95Ms.toFixed(1)} ms`} detail={latencyDetail(roomDiagnostics.serverToClient)} />
              <Metric label="Host send → client p95" value={roomDiagnostics.endToEnd?.p95Ms === null || roomDiagnostics.endToEnd?.p95Ms === undefined ? "—" : `${roomDiagnostics.endToEnd.p95Ms.toFixed(1)} ms`} detail={latencyDetail(roomDiagnostics.endToEnd)} />
              <Metric label="Settled corrections" value={String(roomDiagnostics.corrections?.settledCount ?? 0)} detail={`${roomDiagnostics.corrections?.attemptCount ?? 0} attempts · ${roomDiagnostics.corrections?.failedCount ?? 0} failures`} />
              <Metric label="Client authoritative pre-correction drift" value={Number.isFinite(roomDiagnostics.corrections?.maxPreDriftSeconds) ? `${roomDiagnostics.corrections.maxPreDriftSeconds.toFixed(3)} s max` : "—"} detail={`${roomDiagnostics.corrections?.clientStatePreMeasurementCount ?? 0} valid player measurements`} />
              <Metric label="Client authoritative post-correction drift" value={Number.isFinite(roomDiagnostics.corrections?.maxPostDriftSeconds) ? `${roomDiagnostics.corrections.maxPostDriftSeconds.toFixed(3)} s max` : "—"} detail={`${roomDiagnostics.corrections?.clientStatePostMeasurementCount ?? 0} valid settled measurements`} />
              <Metric label="Pairwise pre-correction drift" value={Number.isFinite(roomDiagnostics.corrections?.maxPairwisePreDriftSeconds) ? `${roomDiagnostics.corrections.maxPairwisePreDriftSeconds.toFixed(3)} s max` : "—"} detail={`${roomDiagnostics.corrections?.pairwisePreMeasurementCount ?? 0} valid two-client measurements`} />
              <Metric label="Pairwise post-correction drift" value={Number.isFinite(roomDiagnostics.corrections?.maxPairwisePostDriftSeconds) ? `${roomDiagnostics.corrections.maxPairwisePostDriftSeconds.toFixed(3)} s max` : "—"} detail={`${roomDiagnostics.corrections?.pairwisePostMeasurementCount ?? 0} valid two-client measurements`} />
              <Metric label="Room correction time" value={Number.isFinite(roomDiagnostics.corrections?.maxDurationMs) ? `${roomDiagnostics.corrections.maxDurationMs.toFixed(0)} ms max` : "—"} detail="from first seek until settle" />
              <Metric label="Measurement failures" value={String(roomDiagnostics.measurementFailures ?? 0)} detail="all clients" />
            </div>
          ) : <p className="mt-2 rounded-lg border border-white/10 p-3 text-xs text-zinc-400">Waiting for two visible, ready clients with fresh samples from the same video.</p>}
          {roomDiagnostics?.participants?.length > 0 && (
            <ul aria-label="Room player measurement statuses" className="mt-2 space-y-1 text-[11px] text-zinc-400">
              {roomDiagnostics.participants.map((client) => (
                <li key={client.clientId} className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono">{client.clientId.slice(0, 8)} · {client.status} · player state {client.playerState ?? "unknown"}</span>
                  <span>{client.sampleAgeMs} ms old · uncertainty ±{Number.isFinite(client.measurementUncertaintyMs) ? `${client.measurementUncertaintyMs.toFixed(1)} ms` : "unknown"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  );
}
