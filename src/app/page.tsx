"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { classNames, Train } from "@/lib/trains";
import { StationPicker, StationOption } from "@/components/station-picker";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type BookingResult = {
  reference: string;
  amount: number;
  train_name: string;
  travel_date: string;
};

type DisplayCurrency = "INR" | "USD";

type Trip = {
  reference: string;
  train_code: string;
  journey_date: string;
  passenger_name: string;
  seat_class: string;
  amount: number;
  trains: {
    name: string;
    from_city: string;
    to_city: string;
    departure: string;
    arrival: string;
  } | null;
};

const defaultFrom: StationOption = { code: "BCT", name: "Mumbai Central", state: "Maharashtra" };
const defaultTo: StationOption = { code: "NDLS", name: "New Delhi", state: "Delhi" };
const DEMO_INR_PER_USD = 83;
const today = new Date();
const todayValue = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
  .toISOString()
  .slice(0, 10);

function formatFare(amountInRupees: number, currency: DisplayCurrency) {
  const amount = currency === "USD" ? amountInRupees / DEMO_INR_PER_USD : amountInRupees;
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(amount);
}

export default function Home() {
  const supabase = useMemo(() => getBrowserSupabase(), []);
  const [from, setFrom] = useState<StationOption | null>(defaultFrom);
  const [to, setTo] = useState<StationOption | null>(defaultTo);
  const [travelDate, setTravelDate] = useState(todayValue);
  const [results, setResults] = useState<Train[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Train | null>(null);
  const [seatClass, setSeatClass] = useState<keyof Train["fares"]>("chair");
  const [passengerName, setPassengerName] = useState("");
  const [passengerEmail, setPassengerEmail] = useState("");
  const [paymentOutcome, setPaymentOutcome] = useState<"success" | "declined">("success");
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("INR");
  const [email, setEmail] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authUsername, setAuthUsername] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<BookingResult | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsError, setTripsError] = useState("");
  const [tripsRevision, setTripsRevision] = useState(0);
  const searchRequest = useRef(0);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setPassengerEmail(data.user?.email ?? "");
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const userEmail = session?.user.email ?? null;
      setEmail(userEmail);
      setTrips([]);
      setTripsError("");
      if (userEmail) setPassengerEmail(userEmail);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!email) return;
    let active = true;
    void fetch("/api/bookings")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load your trips.");
        if (active) {
          setTrips(payload.bookings as Trip[]);
          setTripsError("");
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setTripsError(loadError instanceof Error ? loadError.message : "Could not load your trips.");
        }
      });
    return () => { active = false; };
  }, [email, tripsRevision]);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestId = ++searchRequest.current;
    setError("");
    setSelected(null);
    setConfirmed(null);
    setSearched(true);
    setResults([]);
    if (!from || !to) {
      setSearching(false);
      setError("Choose both stations from the search suggestions.");
      return;
    }
    if (from.code === to.code) {
      setSearching(false);
      setError("Choose two different stations.");
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ from: from.code, to: to.code, date: travelDate });
      const response = await fetch(`/api/trains?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Train search failed.");
      const searchedTrains = (payload.trains as Array<{
        train_code: string;
        train_name: string;
        train_type: string;
        from_code: string;
        from_name: string;
        to_code: string;
        to_name: string;
        departure: string;
        arrival: string;
        from_journey_day: number;
        to_journey_day: number;
        segment_distance: number;
        fares: Train["fares"];
        seats_left: number;
        running_days: Record<string, boolean>;
      }>).map((train) => {
        const minutesOfDay = (time: string) => {
          const match = /^(\d{2}):(\d{2})/.exec(time);
          return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
        };
        const departure = minutesOfDay(train.departure);
        const arrival = minutesOfDay(train.arrival);
        let durationMinutes = Number.isFinite(departure) && Number.isFinite(arrival)
          ? (train.to_journey_day - train.from_journey_day) * 1440 + arrival - departure
          : Number.NaN;
        if (durationMinutes < 0) durationMinutes += 1440;
        const durationDays = Math.floor(durationMinutes / 1440);
        const durationHours = Math.floor((durationMinutes % 1440) / 60);
        const remainingMinutes = durationMinutes % 60;
        const runningDays = Object.entries(train.running_days)
          .filter(([, runs]) => runs)
          .map(([day]) => day)
          .join(", ");
        return {
          code: train.train_code,
          name: train.train_name,
          type: train.train_type,
          fromCode: train.from_code,
          toCode: train.to_code,
          from: train.from_name,
          to: train.to_name,
          departure: train.departure?.slice(0, 5) || "—",
          arrival: train.arrival?.slice(0, 5) || "—",
          duration: Number.isFinite(durationMinutes)
            ? [
                durationDays ? `${durationDays}d` : "",
                durationHours ? `${durationHours}h` : "",
                `${remainingMinutes}m`,
              ].filter(Boolean).join(" ")
            : "—",
          fares: train.fares,
          seats: train.seats_left,
          days: runningDays || "Schedule varies",
          fromJourneyDay: train.from_journey_day,
          toJourneyDay: train.to_journey_day,
          distance: train.segment_distance,
        };
      });
      if (requestId === searchRequest.current) setResults(searchedTrains);
    } catch (searchError) {
      if (requestId === searchRequest.current) {
        setError(searchError instanceof Error ? searchError.message : "Train search failed.");
      }
    } finally {
      if (requestId === searchRequest.current) setSearching(false);
    }
    document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const swapCities = () => {
    setFrom(to);
    setTo(from);
  };

  const openBooking = (train: Train) => {
    setSelected(train);
    setSeatClass("chair");
    setError("");
    setNotice("");
    setConfirmed(null);
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError("Add your Supabase URL and public anon key to .env.local to enable accounts.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    let result;
    try {
      result =
        authMode === "signup"
          ? await supabase.auth.signUp({
              email: authEmail,
              password: authPassword,
              options: { data: { username: authUsername.trim() } },
            })
          : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : "Could not reach the sign-in service. Please try again.");
      return;
    } finally {
      setBusy(false);
    }
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (authMode === "signup" && !result.data.session) {
      setNotice("Check your inbox to verify your account, then sign in.");
      return;
    }
    setEmail(result.data.user?.email ?? null);
    setPassengerEmail(result.data.user?.email ?? "");
    setAuthOpen(false);
    setNotice(authMode === "signup" ? "Account created. You can book your trip." : "Welcome back.");
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    else {
      setEmail(null);
      setNotice("You have been signed out.");
    }
  };

  const completeBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!supabase) {
      setError("Booking is not enabled yet. Configure Supabase to securely save tickets.");
      return;
    }
    if (!email) {
      setError("Sign in or create an account before booking.");
      setAuthOpen(true);
      return;
    }
    if (!selected) return;

    setBusy(true);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainCode: selected.code,
          fromCode: selected.fromCode,
          toCode: selected.toCode,
          travelDate,
          passengerName,
          passengerEmail,
          seatClass,
          paymentOutcome,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "We could not complete this booking.");
        return;
      }
      setConfirmed(payload.booking as BookingResult);
      setNotice(payload.message);
      setSelected(null);
      setTripsRevision((revision) => revision + 1);
      document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setError("We could not reach the booking service. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#" aria-label="RailYatra home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span>railyatra<span className="brand-period">.</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#search">Book a ticket</a>
          <a href="#my-trips">My trips</a>
          <a href="#why-us">Why RailYatra</a>
          <a href="#footer">Help</a>
        </nav>
        <div className="header-account">
          {email ? (
            <>
              <span className="signed-in">{email}</span>
              <button className="button button-outline header-button" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <button
              className="button button-outline header-button"
              onClick={() => { setAuthMode("signin"); setAuthOpen(true); setError(""); }}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <section className="hero" id="search">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT STOP STARTS HERE</div>
            <h1>Good trips<br />begin <em>together.</em></h1>
            <p>Find your train, pick your seat, and get on with the good part.</p>
            <div className="hero-perks">
              <span><span className="perk-icon">✓</span> Easy booking</span>
              <span><span className="perk-icon">✓</span> Clear fares</span>
              <span><span className="perk-icon">✓</span> No surprises</span>
            </div>
          </div>
          <div className="journey-art" aria-hidden="true">
            <div className="art-sun" />
            <div className="art-hill art-hill-back" />
            <div className="art-hill art-hill-front" />
            <div className="art-line art-line-one" />
            <div className="art-line art-line-two" />
            <div className="art-train">
              <div className="train-window" /><div className="train-window" /><div className="train-window" />
              <div className="train-light" /><div className="train-wheel wheel-one" /><div className="train-wheel wheel-two" />
            </div>
            <div className="art-station">THE SCENIC ROUTE LOOKS GOOD ON YOU</div>
          </div>
        </div>
        <form className="search-card" onSubmit={search}>
          <StationPicker
            id="from"
            label="FROM"
            station={from}
            placeholder="Search station"
            onSelect={setFrom}
          />
          <button className="swap-button" type="button" aria-label="Swap departure and destination" onClick={swapCities}>↔</button>
          <StationPicker
            id="to"
            label="TO"
            station={to}
            placeholder="Search station"
            onSelect={setTo}
          />
          <div className="search-divider" />
          <div className="search-field date-field">
            <label htmlFor="travel-date">JOURNEY DATE</label>
            <input id="travel-date" type="date" min={todayValue} value={travelDate} onChange={(event) => setTravelDate(event.target.value)} required />
          </div>
          <button className="button button-primary search-button" type="submit"><span>Find my train</span><span aria-hidden="true">→</span></button>
        </form>
      </section>

      <section className="content-wrap" id="results">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE JOURNEY IS YOURS</span>
            <h2>{searched ? `${from?.name ?? "Departure"} to ${to?.name ?? "Destination"}` : "Your next good journey"}</h2>
          </div>
          <div className="results-meta">
            <span className="result-date">{searched ? new Date(`${travelDate}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "Real timetable dataset · Demo bookings"}</span>
            <label className="currency-picker" htmlFor="display-currency">
              Currency
              <select
                id="display-currency"
                className="form-select currency-select"
                value={displayCurrency}
                onChange={(event) => setDisplayCurrency(event.target.value as DisplayCurrency)}
              >
                <option value="INR">Indian Rupee (INR)</option>
                <option value="USD">US Dollar (USD)</option>
              </select>
            </label>
          </div>
        </div>

        {searching && <div className="empty-state"><p>Finding trains for your journey…</p></div>}
        {searched && !searching && results.length === 0 && !error && (
          <div className="empty-state">
            <div className="empty-icon">↗</div>
            <h3>No scheduled trains found for this route and date</h3>
            <p>Choose both stations from the suggestions, then try a nearby date or station.</p>
          </div>
        )}
        <div className="train-list">
          {results.map((train, index) => (
            <article className={`train-card ${index === 0 && !searched ? "featured-card" : ""}`} key={`${train.code}-${train.from}-${train.to}-${train.name}`}>
              <div className="train-identity">
                <span className="train-symbol" aria-hidden="true">↗</span>
                <div><h3>{train.name}</h3><span>{train.code} {train.type && <><span className="dot-separator">·</span> {train.type}</>} <span className="dot-separator">·</span> {train.days}</span></div>
              </div>
              <div className="train-timing">
                <div><strong>{train.departure}</strong><span>{train.from}</span></div>
                <div className="journey-duration"><span>{train.duration}</span><span className="duration-line"><i /></span></div>
                <div className="arrival-time"><strong>{train.arrival}</strong><span>{train.to}</span></div>
              </div>
              <div className="train-fare">
                <span>from <strong>{formatFare(Math.min(...Object.values(train.fares)), displayCurrency)}</strong></span>
                <span className="availability">{train.seats} demo seats · {train.distance} km</span>
              </div>
              <button className="button button-dark" onClick={() => openBooking(train)} disabled={train.seats < 1}>Choose train <span aria-hidden="true">→</span></button>
            </article>
          ))}
        </div>
        {error && !selected && <p className="message message-error search-error" role="alert">{error}</p>}
        <p className="demo-note">Schedules come from the open Indian Railway Data dataset; verify operating times with the railway operator. Fares and seat counts are simulations, not live data. Display conversion uses the fixed demo rate ₹{DEMO_INR_PER_USD} = $1.</p>
        <div className="my-trips" id="my-trips">
          <div className="trips-heading">
            <div><span className="eyebrow">SAVED TO YOUR ACCOUNT</span><h3>Your trips</h3></div>
            {!email && <button className="text-button" onClick={() => { setAuthMode("signin"); setAuthOpen(true); setError(""); }}>Sign in to view</button>}
          </div>
          {tripsError && <p className="message message-error" role="alert">{tripsError}</p>}
          {email && trips.length === 0 && !tripsError && <p className="trips-empty">No bookings yet. Your next journey will show up here.</p>}
          {trips.map((trip) => (
            <article className="trip-row" key={trip.reference}>
              <div><strong>{trip.trains?.name ?? `Train ${trip.train_code}`}</strong><span>{trip.trains?.from_city} → {trip.trains?.to_city} · {trip.seat_class}</span></div>
              <div><span>{new Date(`${trip.journey_date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span><strong>{formatFare(trip.amount, displayCurrency)}</strong></div>
              <span className="trip-reference">{trip.reference}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="booking-section" id="booking">
        <div className="booking-container">
          <div className="booking-intro">
            <span className="eyebrow">A FEW MORE DETAILS</span>
            <h2>{confirmed ? "You’re all set." : selected ? "Make it official." : "Ready when you are."}</h2>
            <p>{confirmed ? "Your demo ticket has been saved to your account." : "Pick your class, add your details, and you’re on your way."}</p>
            <div className="booking-steps">
              <span className="step-done">01 <i /> Find a train</span>
              <span className={selected || confirmed ? "step-done" : ""}>02 <i /> Your details</span>
              <span className={confirmed ? "step-done" : ""}>03 <i /> All aboard</span>
            </div>
          </div>
          <div className="booking-panel">
            {confirmed ? (
              <div className="confirmation">
                <div className="confirmation-icon">✓</div>
                <span className="eyebrow">BOOKING CONFIRMED</span>
                <h3>Your seat is saved.</h3>
                <p>{confirmed.train_name} · {new Date(`${confirmed.travel_date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
                <div className="reference-box"><span>DEMO BOOKING REFERENCE</span><strong>{confirmed.reference}</strong></div>
                <p className="receipt-note">Demo fare {formatFare(confirmed.amount, displayCurrency)}. No real payment was taken. This is not a valid rail ticket.</p>
                {notice && <p className="message message-success" role="status">{notice}</p>}
                <button className="button button-outline" onClick={() => setConfirmed(null)}>Book another trip</button>
              </div>
            ) : !selected ? (
              <div className="booking-placeholder">
                <span className="placeholder-icon">✳</span>
                <h3>Your next chapter awaits.</h3>
                <p>Choose a train above to see class options and continue.</p>
              </div>
            ) : (
              <form className="booking-form" onSubmit={completeBooking}>
                <div className="selected-route">
                  <div><span className="form-label">YOUR TRAIN · {selected.code}</span><strong>{selected.name}</strong><span>{selected.from} ({selected.fromCode}) <i>→</i> {selected.to} ({selected.toCode})</span></div>
                  <button type="button" className="text-button" onClick={() => setSelected(null)}>Change</button>
                </div>
                <label className="form-label" htmlFor="seat-class">TRAVEL CLASS</label>
                <select id="seat-class" className="form-select" value={seatClass} onChange={(event) => setSeatClass(event.target.value as keyof Train["fares"])}>
                  {(Object.keys(classNames) as Array<keyof Train["fares"]>).map((key) => (
                    <option key={key} value={key}>{classNames[key]} · {formatFare(selected.fares[key], displayCurrency)}</option>
                  ))}
                </select>
                <label className="form-label" htmlFor="passenger-name">PASSENGER NAME</label>
                <input className="form-input" id="passenger-name" autoComplete="name" minLength={2} maxLength={100} value={passengerName} onChange={(event) => setPassengerName(event.target.value)} placeholder="Name as on your ID" required />
                <label className="form-label" htmlFor="passenger-email">CONFIRMATION EMAIL</label>
                <input className="form-input" id="passenger-email" type="email" autoComplete="email" value={passengerEmail} onChange={(event) => setPassengerEmail(event.target.value)} placeholder="you@example.com" required />
                <span className="form-hint">Use the email address associated with your account.</span>
                <fieldset className="payment-choice">
                  <legend className="form-label">DEMO PAYMENT · NO REAL CHARGE</legend>
                  <label><input type="radio" name="payment" value="success" checked={paymentOutcome === "success"} onChange={() => setPaymentOutcome("success")} /> Approve test payment</label>
                  <label><input type="radio" name="payment" value="declined" checked={paymentOutcome === "declined"} onChange={() => setPaymentOutcome("declined")} /> Simulate a decline</label>
                </fieldset>
                {error && <p className="message message-error" role="alert">{error}</p>}
                <div className="fare-total"><span>Total demo fare</span><strong>{formatFare(selected.fares[seatClass], displayCurrency)}</strong></div>
                {!email ? (
                  <button className="button button-primary full-button" type="button" onClick={() => { setAuthMode("signin"); setAuthOpen(true); setError(""); }}>
                    Sign in to continue <span aria-hidden="true">→</span>
                  </button>
                ) : (
                  <button className="button button-primary full-button" type="submit" disabled={busy}>
                    {busy ? "Confirming…" : "Confirm demo booking"} <span aria-hidden="true">→</span>
                  </button>
                )}
                <p className="secure-note">🔒 Your demo booking is tied to your signed-in account. No real payment is collected.</p>
              </form>
            )}
          </div>
        </div>
      </section>

      <section className="why-section" id="why-us">
        <div className="why-heading"><span className="eyebrow">LESS FUSS. MORE WINDOWSIDE.</span><h2>Travel, the way it should feel.</h2></div>
        <div className="benefit-grid">
          <article><span className="benefit-number">01</span><div className="benefit-icon">⌕</div><h3>Find your way</h3><p>Simple city-to-city search that gets right to the good options.</p></article>
          <article><span className="benefit-number">02</span><div className="benefit-icon">↗</div><h3>Know the fare</h3><p>See class choices and prices upfront, before you make a decision.</p></article>
          <article><span className="benefit-number">03</span><div className="benefit-icon">♡</div><h3>Feel looked after</h3><p>Your booking stays linked to your account, with an email receipt when configured.</p></article>
        </div>
      </section>

      <footer className="site-footer" id="footer">
        <a className="brand footer-brand" href="#"><span className="brand-mark" aria-hidden="true">R</span><span>railyatra<span className="brand-period">.</span></span></a>
        <p>Real rail schedules. A little less fuss.</p>
        <span className="footer-disclaimer">Third-party timetable data · Demo fares and booking only · Not affiliated with a railway operator</span>
      </footer>

      {notice && !authOpen && !selected && !confirmed && (
        <div className="toast" role="status">
          <span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss">×</button>
        </div>
      )}

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="modal-close" onClick={() => setAuthOpen(false)} aria-label="Close">×</button>
            <span className="eyebrow">{authMode === "signin" ? "GOOD TO SEE YOU" : "YOUR NEXT TRIP STARTS HERE"}</span>
            <h2 id="auth-title">{authMode === "signin" ? "Welcome back." : "Let’s get you going."}</h2>
            <p>{authMode === "signin" ? "Sign in to save your booking." : "Create an account to keep your tickets together."}</p>
            <form onSubmit={handleAuth}>
              {authMode === "signup" && (
                <>
                  <label className="form-label" htmlFor="auth-username">USERNAME</label>
                  <input
                    className="form-input"
                    id="auth-username"
                    type="text"
                    autoComplete="username"
                    minLength={2}
                    maxLength={60}
                    value={authUsername}
                    onChange={(event) => setAuthUsername(event.target.value)}
                    required
                  />
                </>
              )}
              <label className="form-label" htmlFor="auth-email">EMAIL ADDRESS</label>
              <input className="form-input" id="auth-email" type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required />
              <label className="form-label" htmlFor="auth-password">PASSWORD</label>
              <input className="form-input" id="auth-password" type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} minLength={8} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required />
              {error && <p className="message message-error" role="alert">{error}</p>}
              {notice && <p className="message message-success" role="status">{notice}</p>}
              <button className="button button-primary full-button" type="submit" disabled={busy}>{busy ? "One moment…" : authMode === "signin" ? "Sign in" : "Create account"} <span aria-hidden="true">→</span></button>
            </form>
            <p className="auth-switch">
              {authMode === "signin" ? "New around here?" : "Already have an account?"}{" "}
              <button className="text-button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>
                {authMode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
