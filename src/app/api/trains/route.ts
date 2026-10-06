import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from")?.toUpperCase() ?? "";
  const to = params.get("to")?.toUpperCase() ?? "";
  const date = params.get("date") ?? "";

  if (
    !/^[A-Z0-9-]{2,10}$/.test(from) ||
    !/^[A-Z0-9-]{2,10}$/.test(to) ||
    from === to ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return NextResponse.json(
      { error: "Choose two different stations and a valid travel date." },
      { status: 400 },
    );
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Train search is unavailable until Supabase is configured." },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.rpc("search_demo_trains", {
    p_from_station: from,
    p_to_station: to,
    p_travel_date: date,
  });
  if (error) {
    console.error("Train search failed:", error.message);
    return NextResponse.json(
      { error: "Trains could not be searched. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ trains: data ?? [] });
}
