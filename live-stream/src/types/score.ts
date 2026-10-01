// Shape of the CricScore overlay feed (GET /api/live/:code/overlay on the CricScore server)
export interface ScoreBall {
  runs: number;
  extra?: string;
  wicket?: boolean;
}

export interface LiveScore {
  version: number;
  phase: 'waiting' | 'scoring' | 'innings_end';
  inningsNum?: 1 | 2;
  battingTeam?: string;
  bowlingTeam?: string;
  matchType?: 'local' | 'domestic';
  overs?: number;
  target?: number | null;
  runs?: number;
  wickets?: number;
  over?: number;
  ball?: number;
  striker?: { name: string; runs: number; balls: number } | null;
  nonStriker?: { name: string; runs: number; balls: number } | null;
  bowler?: { name: string; overs: number; balls: number; runs: number; wickets: number } | null;
  thisOver?: ScoreBall[];
  deliveries?: number;
  lastBall?: ScoreBall | null;
  lastCommentary?: string;
  result?: string;
}
