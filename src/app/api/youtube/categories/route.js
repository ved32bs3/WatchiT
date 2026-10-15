import { NextResponse } from "next/server";
import { getMovieCategories, getYouTubeConfig } from "@/app/lib/youtube";

export async function GET() {
  const config = getYouTubeConfig();
  if (config.error) return NextResponse.json({ error: config.error }, { status: 503 });

  try {
    const categories = await getMovieCategories(config.apiKey, config.regionCode);
    return NextResponse.json({ categories, regionCode: config.regionCode });
  } catch (error) {
    console.error("YouTube category request failed", { message: error.message });
    return NextResponse.json(
      { error: "Could not load movie categories from YouTube." },
      { status: error.status || 502 },
    );
  }
}
