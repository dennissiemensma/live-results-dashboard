// ── Backend WebSocket message shapes ─────────────────────────────────────────

/** distance_meta message payload */
export interface DistanceMeta {
  id: string;
  name: string;
  event_number: number;
  is_live: boolean;
  is_mass_start: boolean;
  distance_meters: number | null;
  total_laps: number | null;
  any_finished: boolean;
  finishing_line_after: string | null;
  heat_groups: HeatGroupMeta[];
}

/** One heat entry inside distance_meta.heat_groups */
export interface HeatGroupMeta {
  heat: number;
  race_ids: string[];
}

/** competitor_update message payload */
export interface CompetitorUpdate {
  id: string;
  distance_id: string;
  start_number: string;
  name: string;
  heat: number;
  lane: string;
  laps_count: number;
  total_time: string;
  formatted_total_time: string;
  position: number;
  position_change: 'up' | 'down' | null;
  laps_remaining: number | null;
  is_final_lap: boolean;
  finished_rank: number | null;
  /** Set by frontend on receive for flash-update animation */
  lastUpdated?: number;
  /** Computed by frontend grouping logic */
  group_number?: number | null;
  /** Computed by frontend grouping logic */
  gap_to_above?: string | null;
}

// ── Frontend view state ───────────────────────────────────────────────────────

/** Full local state for one distance, assembled from backend messages */
export interface ProcessedDistance {
  id: string;
  name: string;
  eventNumber: number;
  isLive: boolean;
  isMassStart: boolean;
  distanceMeters: number | null;
  totalLaps: number | null;
  anyFinished: boolean;
  finishingLineAfter: string | null;
  /** Ordered list of competitors (sorted by backend: laps desc, time asc) */
  processedRaces: CompetitorUpdate[];
  /** Computed by frontend from processedRaces + group threshold setting */
  standingsGroups: StandingsGroup[];
  heatGroups: HeatGroup[];
}

/** Resolved standings group for rendering (computed by frontend) */
export interface StandingsGroup {
  groupNumber: number;
  laps: number;
  leaderTime: string | null;
  gapToGroupAhead: string | null;
  timeBehindLeader: string | null;
  isLastGroup: boolean;
  races: CompetitorUpdate[];
}

/** Resolved heat group for rendering */
export interface HeatGroup {
  heat: number;
  races: CompetitorUpdate[];
}
