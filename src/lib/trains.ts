export type Train = {
  code: string;
  name: string;
  type: string;
  fromCode: string;
  toCode: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  duration: string;
  fares: { sleeper: number; chair: number; executive: number };
  seats: number;
  days: string;
  fromJourneyDay: number;
  toJourneyDay: number;
  distance: number;
};

export const classNames: Record<keyof Train["fares"], string> = {
  sleeper: "Sleeper",
  chair: "AC Chair",
  executive: "Executive",
};
