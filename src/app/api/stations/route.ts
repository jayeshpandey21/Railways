import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const rawQuery = new URL(request.url).searchParams.get("q") ?? "";
  const query = rawQuery.trim().replace(/[^a-zA-Z0-9 -]/g, "").slice(0, 40);

  if (query.length < 2) {
    return NextResponse.json({ stations: [] });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Station search is unavailable until Supabase is configured." },
      { status: 503 },
    );
  }

  const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
  const [byName, byCode] = await Promise.all([
    supabase
      .from("stations")
      .select("code, name, state")
      .ilike("name", `%${escapedQuery}%`)
      .limit(12),
    supabase
      .from("stations")
      .select("code, name, state")
      .ilike("code", `${escapedQuery}%`)
      .limit(12),
  ]);

  if (byName.error || byCode.error) {
    console.error("Station search failed:", byName.error?.message ?? byCode.error?.message);
    return NextResponse.json(
      { error: "Stations could not be searched. Please try again." },
      { status: 500 },
    );
  }

  const stations = new Map<string, { code: string; name: string; state: string }>();
  for (const station of [...(byName.data ?? []), ...(byCode.data ?? [])]) {
    stations.set(station.code, station);
  }

  return NextResponse.json({ stations: [...stations.values()].slice(0, 16) });
}
