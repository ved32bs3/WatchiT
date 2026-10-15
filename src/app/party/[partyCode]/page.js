import { Suspense } from "react";
import PartyRoomClient from "@/app/components/PartyRoomClient";

export default function PartyRoomPage() {
  return (
    <Suspense
      fallback={(
        <main className="grid min-h-screen place-items-center bg-[#09090b] px-5 text-white">
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-7 text-center">
            <h1 className="text-xl font-semibold">Opening party...</h1>
            <p className="mt-3 text-sm text-zinc-400">Connecting to the party room.</p>
          </section>
        </main>
      )}
    >
      <PartyRoomClient />
    </Suspense>
  );
}
