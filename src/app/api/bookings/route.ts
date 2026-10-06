import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

type BookingRequest = {
  trainCode?: unknown;
  fromCode?: unknown;
  toCode?: unknown;
  travelDate?: unknown;
  passengerName?: unknown;
  passengerEmail?: unknown;
  seatClass?: unknown;
  paymentOutcome?: unknown;
};

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Bookings are unavailable until Supabase is configured." },
      { status: 503 },
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Sign in before booking a ticket." },
      { status: 401 },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const body = parsedBody as BookingRequest;

  if (
    typeof body.trainCode !== "string" ||
    typeof body.fromCode !== "string" ||
    typeof body.toCode !== "string" ||
    typeof body.travelDate !== "string" ||
    typeof body.passengerName !== "string" ||
    typeof body.passengerEmail !== "string" ||
    !/^[A-Z0-9-]{2,10}$/i.test(body.fromCode) ||
    !/^[A-Z0-9-]{2,10}$/i.test(body.toCode) ||
    body.fromCode.toUpperCase() === body.toCode.toUpperCase() ||
    !["sleeper", "chair", "executive"].includes(String(body.seatClass)) ||
    !["success", "declined"].includes(String(body.paymentOutcome))
  ) {
    return NextResponse.json(
      { error: "Complete all booking details and choose a test payment outcome." },
      { status: 400 },
    );
  }

  if (body.paymentOutcome === "declined") {
    return NextResponse.json(
      { error: "The simulated payment was declined. No booking was made." },
      { status: 402 },
    );
  }

  const passengerName = body.passengerName.trim();
  const passengerEmail = body.passengerEmail.trim().toLowerCase();
  const parsedTravelDate = new Date(`${body.travelDate}T00:00:00.000Z`);
  if (
    passengerName.length < 2 ||
    passengerName.length > 100 ||
    passengerEmail !== user.email?.toLowerCase() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.travelDate) ||
    Number.isNaN(parsedTravelDate.getTime()) ||
    parsedTravelDate.toISOString().slice(0, 10) !== body.travelDate
  ) {
    return NextResponse.json(
      { error: "Enter a valid passenger name, date, and your signed-in email address." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("create_demo_booking", {
    p_train_code: body.trainCode,
    p_from_station: body.fromCode,
    p_to_station: body.toCode,
    p_travel_date: body.travelDate,
    p_passenger_name: passengerName,
    p_passenger_email: passengerEmail,
    p_seat_class: body.seatClass,
  });

  if (error) {
    const expectedErrors = new Map([
      ["No demo seats are left on this segment for the selected date.", 409],
      ["This train does not run on the selected date.", 400],
      ["Choose two stations on this train in travel order.", 400],
      ["Choose a travel date within the next 365 days.", 400],
      ["Choose a valid travel class.", 400],
      ["Enter a passenger name between 2 and 100 characters.", 400],
      ["The passenger email must match your signed-in account.", 400],
      ["This train is not available.", 404],
      ["Sign in before booking a ticket.", 401],
    ]);
    const status = expectedErrors.get(error.message);
    if (!status) {
      console.error("Demo booking could not be saved:", error.message);
      return NextResponse.json(
        { error: "We could not save this booking. Please try again." },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status });
  }

  const booking = data as {
    reference: string;
    train_name: string;
    train_code: string;
    from_city: string;
    to_city: string;
    travel_date: string;
    departure: string;
    arrival: string;
    seat_class: string;
    amount: number;
    passenger_name: string;
  };

  const emailApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!emailApiKey || !emailFrom) {
    return NextResponse.json({
      booking,
      emailStatus: "not_configured",
      message: "Ticket confirmed. Email delivery is not configured yet.",
    });
  }

  try {
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${emailApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [passengerEmail],
        subject: `Your RailYatra ticket ${booking.reference}`,
        text: [
          `Hello ${booking.passenger_name},`,
          "",
          "Your simulated payment was successful and your demo ticket is confirmed.",
          `Train: ${booking.train_name} (${booking.train_code})`,
          `Route: ${booking.from_city} to ${booking.to_city}`,
          `Date: ${booking.travel_date}`,
          `Departure: ${booking.departure} · Arrival: ${booking.arrival}`,
          `Class: ${booking.seat_class}`,
          `Demo fare: ₹${booking.amount}`,
          `Booking reference: ${booking.reference}`,
          "",
          "This is a demonstration booking. No real payment was taken and this is not a valid rail ticket.",
        ].join("\n"),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!emailResponse.ok) {
      console.error("Ticket email provider returned an error:", emailResponse.status);
      return NextResponse.json({
        booking,
        emailStatus: "failed",
        message: "Ticket confirmed, but the confirmation email could not be sent.",
      });
    }
  } catch (error) {
    console.error("Ticket email delivery failed:", error);
    return NextResponse.json({
      booking,
      emailStatus: "failed",
      message: "Ticket confirmed, but the confirmation email could not be sent.",
    });
  }

  return NextResponse.json({
    booking,
    emailStatus: "sent",
    message: "Ticket confirmed and confirmation email sent.",
  });
}

export async function GET() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Bookings are unavailable until Supabase is configured." },
      { status: 503 },
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to view your trips." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("reference, train_code, journey_date, passenger_name, seat_class, amount, from_station_code, to_station_code")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load account bookings:", error.message);
    return NextResponse.json(
      { error: "Your trips could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  const trainCodes = [...new Set((data ?? []).map((booking) => booking.train_code))];
  const { data: trainData, error: trainError } = trainCodes.length
    ? await supabase.from("trains").select("code, name, route").in("code", trainCodes)
    : { data: [], error: null };

  if (trainError) {
    console.error("Could not load booked train details:", trainError.message);
    return NextResponse.json(
      { error: "Your trip details could not be loaded. Please try again." },
      { status: 500 },
    );
  }

  const trainByCode = new Map((trainData ?? []).map((train) => [train.code, train]));
  const bookings = (data ?? []).map((booking) => {
    const train = trainByCode.get(booking.train_code);
    const route = Array.isArray(train?.route) ? train.route : [];
    const fromStop = route.find(
      (stop: { stationCode?: string }) => stop.stationCode === booking.from_station_code,
    );
    const toStop = route.find(
      (stop: { stationCode?: string }) => stop.stationCode === booking.to_station_code,
    );
    return {
      ...booking,
      trains: {
        name: train?.name ?? `Train ${booking.train_code}`,
        from_city: fromStop?.stationName ?? booking.from_station_code,
        to_city: toStop?.stationName ?? booking.to_station_code,
        departure: fromStop?.departureTime ?? fromStop?.arrivalTime ?? "",
        arrival: toStop?.arrivalTime ?? toStop?.departureTime ?? "",
      },
    };
  });

  return NextResponse.json({ bookings });
}
