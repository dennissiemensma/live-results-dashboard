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
}

export interface HeatGroup {
  heat: number;
  races: ProcessedRace[];
}

export interface ProcessedDistance extends Distance {
  isMassStart: boolean;
  processedRaces: ProcessedRace[];
  /** Heat-grouped races for non-mass-start left column */
  heatGroups?: HeatGroup[];
  /** Laps/time groups for mass-start right column */
  standingsGroups?: StandingsGroup[];
}

export interface StandingsGroup {
  laps: number;
  races: ProcessedRace[];
  /** Formatted time of the first competitor (leader of this group) */
  leaderTime?: string;
  /** Gap from last of previous group to first of this group, e.g. "+0.456" */
  gapToPreviousGroup?: string;
  /** Total time behind the overall race leader (first of first group), e.g. "+12.345s" */
  timeBehindLeader?: string;
}
