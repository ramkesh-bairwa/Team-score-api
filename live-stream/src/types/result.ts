// Final result of a CricScore match (the `final` field of the overlay feed once the match is over)
export interface MatchResult {
  winner: string | null;
  loser: string | null;
  tied: boolean;
  margin: string;
  innings: { team: string; runs: number; wickets: number; overs: number; balls: number }[];
  teams: {
    name: string;
    bestBatter: { name: string; runs: number; balls: number; fours: number; sixes: number; out: boolean } | null;
    bestBowler: { name: string; wickets: number; runs: number; overs: number; balls: number } | null;
  }[];
}
