import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const revision = "1dc0ddbc6a06b09ef69d4825ff3127c1f29640fa";
const source = `https://raw.githubusercontent.com/prasenjit-27/Indian-Railway-Data/${revision}`;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const tempDirectory = await mkdtemp(join(tmpdir(), "railyatra-import-"));

async function download(fileName) {
  const response = await fetch(`${source}/${fileName}`, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${fileName}: HTTP ${response.status}.`);
  }
  const path = join(tempDirectory, fileName);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  return path;
}

async function* readJsonArray(path) {
  for await (const entry of chain([
    createReadStream(path),
    parser(),
    streamArray(),
  ])) {
    yield entry.value;
  }
}

async function upsertBatches(table, rows, batchSize) {
  let batch = [];
  let count = 0;
  for await (const row of rows) {
    batch.push(row);
    if (batch.length === batchSize) {
      const { error } = await supabase.from(table).upsert(batch);
      if (error) throw new Error(`Could not import ${table}: ${error.message}`);
      count += batch.length;
      batch = [];
      console.log(`Imported ${count} ${table}.`);
    }
  }
  if (batch.length) {
    const { error } = await supabase.from(table).upsert(batch);
    if (error) throw new Error(`Could not import ${table}: ${error.message}`);
    count += batch.length;
  }
  return count;
}

async function* stationRows(path) {
  for await (const station of readJsonArray(path)) {
    if (typeof station.code !== "string" || typeof station.name !== "string") continue;
    yield {
      code: station.code.trim().toUpperCase(),
      name: station.name.trim(),
      state: typeof station.state === "string" ? station.state : "",
      zone: typeof station.zone === "string" ? station.zone : "",
    };
  }
}

async function* trainRows(path) {
  for await (const train of readJsonArray(path)) {
    if (
      typeof train.trainNumber !== "string" ||
      typeof train.trainName !== "string" ||
      !Array.isArray(train.completeOrderedRoute)
    ) continue;

    const route = train.completeOrderedRoute
      .filter((stop) =>
        typeof stop.stationCode === "string" &&
        typeof stop.stationName === "string" &&
        Number.isInteger(stop.sequence) &&
        Number.isInteger(stop.journeyDay) &&
        Number.isFinite(Number(stop.distance)),
      )
      .map((stop) => ({
        sequence: stop.sequence,
        stationCode: stop.stationCode.trim().toUpperCase(),
        stationName: stop.stationName.trim(),
        arrivalTime: typeof stop.arrivalTime === "string" ? stop.arrivalTime : null,
        departureTime: typeof stop.departureTime === "string" ? stop.departureTime : null,
        journeyDay: stop.journeyDay,
        distance: Number(stop.distance),
      }))
      .sort((a, b) => a.sequence - b.sequence);

    if (route.length < 2) continue;
    const runningDays = Object.fromEntries(
      ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
        .map((day) => [day, train.runningDays?.[day] === true]),
    );
    const origin = route[0];
    const destination = route[route.length - 1];

    yield {
      code: train.trainNumber.trim(),
      name: train.trainName.trim(),
      from_city: origin.stationName,
      to_city: destination.stationName,
      departure: origin.departureTime ?? origin.arrivalTime ?? "",
      arrival: destination.arrivalTime ?? destination.departureTime ?? "",
      duration: "",
      fares: { sleeper: 50, chair: 80, executive: 120 },
      seats: 100,
      demo_capacity: 100,
      days: Object.entries(runningDays).filter(([, runs]) => runs).map(([day]) => day).join(", "),
      train_type: typeof train.type === "string" ? train.type : "",
      running_days: runningDays,
      overall_distance_km: Number.isFinite(Number(train.overallDistanceKm))
        ? Number(train.overallDistanceKm)
        : 0,
      route,
    };
  }
}

try {
  console.log("Downloading the MIT-licensed station and train schedules.");
  const stationsPath = await download("stations.json");
  const trainsPath = await download("trains.json");

  const stationCount = await upsertBatches("stations", stationRows(stationsPath), 500);
  const trainCount = await upsertBatches("trains", trainRows(trainsPath), 100);
  console.log(`Import complete: ${stationCount} stations and ${trainCount} trains.`);
  console.log("Train fares, capacity, and reservations in this app remain demo-only.");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
