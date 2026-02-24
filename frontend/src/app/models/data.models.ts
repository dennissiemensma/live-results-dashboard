export interface Competitor {
  id: string;
  name: string;
  startNumber: string;
}

export interface Lap {
  time: string;
  lapTime?: string; // Additional field might be present
}

export interface Race {
  id: string;
  heat: number;
  lane: string; // "RED", "BLUE", "YELLOW", "GREEN"
  competitor: Competitor;
  laps: Lap[];
}

export interface Distance {
  id: string;
  name: string;
  eventNumber: number;
  isLive: boolean;
  races: Race[];
}

export interface LiveData {
  success?: boolean;
  name: string;
  distances: Distance[];
}

export interface ProcessedRace {
  id: string;
  competitorName: string;
  startNumber: string;
  lane: string;
  heat: number;
  lapsCount: number;
  totalTime: string;
  formattedTotalTime: string;
  lapTimes: string[];
  lastUpdated: number;
  /** Gap to the competitor directly above in a standings group, e.g. "+0.456" */
  gapToAbove?: string;
  /** Position change vs previous update: 'up' | 'down' | null */
  positionChange?: 'up' | 'down' | null;
  /** Laps remaining until totalLaps, if known */
  lapsRemaining?: number;
  /** True when exactly 1 lap remains */
  isFinalLap?: boolean;
  /** 1-based finishing rank among completed competitors (lapsRemaining === 0), or undefined */
  finishedRank?: number;
}

export interface HeatGroup {
  heat: number;
  races: ProcessedRace[];
}

export interface ProcessedDistance extends Distance {
  isMassStart: boolean;
  processedRaces: ProcessedRace[];
  distanceMeters?: number;
  totalLaps?: number;
  heatGroups?: HeatGroup[];
  standingsGroups?: StandingsGroup[];
  /** Race id after which to render the finishing line (last updated race this tick) */
  finishingLineAfter?: string | null;
  /** True once at least one competitor has finished (lapsRemaining === 0) */
  anyFinished?: boolean;
}

export interface StandingsGroup {
  laps: number;
  races: ProcessedRace[];
  /** 1-based group number; 1 = head of race */
  groupNumber: number;
  /** Formatted time of the first competitor (leader of this group) */
  leaderTime?: string;
  /** Gap from first of this group to last of the group directly ahead, e.g. "+5.234s" */
  gapToGroupAhead?: string;
  /** Total time behind the overall race leader (first of first group), e.g. "+12.345s" */
  timeBehindLeader?: string;
  /** True for the tail group (highest groupNumber) — merges into the group ahead */
  isLastGroup?: boolean;
}
