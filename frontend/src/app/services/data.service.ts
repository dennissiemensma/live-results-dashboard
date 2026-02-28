import { Injectable, NgZone } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { BehaviorSubject } from 'rxjs';
import {
  DistanceMeta,
  CompetitorUpdate,
  ProcessedDistance,
  StandingsGroup,
} from '../models/data.models';
import { HttpClient } from '@angular/common/http';

export interface BackendStatus {
  status: 'Disconnected' | 'Connecting...' | 'Connected' | 'Error';
  url: string;
  interval: number | null;
}

export interface DebugEntry {
  timestamp: number;
  name: string;
  startNumber: string;
  distanceId: string;
  distanceName: string;
  lapsCount: number;
  currentLapTime: string;
  formattedTotalTime: string;
}

const RENDER_INTERVAL_MS = 250;
const LANE_ORDER: Record<string, number> = { white: 0, red: 1, yellow: 2, blue: 3 };
const LANE_ORDER_KEYS = Object.keys(LANE_ORDER); // ['white','red','yellow','blue']
const DEFAULT_GROUP_THRESHOLD = 2.0;
const MAX_GROUP_THRESHOLD = 10.0;
const DEFAULT_MAX_GROUPS = 4;
const DEFAULT_LAP_VARIANCE = 5;
const STORAGE_KEY_THRESHOLD = 'groupThresholdSec';
const STORAGE_KEY_MAX_GROUPS = 'maxGroups';
const STORAGE_KEY_LAP_VARIANCE = 'lapVariancePct';
const STORAGE_KEY_SHOW_LAP_TIMES = 'showMassStartLapTimes';
const MAX_DEBUG_ENTRIES = 200;

@Injectable({ providedIn: 'root' })
export class DataService {
  private socket$: WebSocketSubject<any> | null = null;
  private readonly BACKEND_URL = `ws://${window.location.hostname}:5000/ws`;
  private readonly BACKEND_HTTP_URL = `http://${window.location.hostname}:5000`;

  private _status = new BehaviorSubject<BackendStatus>({ status: 'Disconnected', url: '', interval: null });
  public status$ = this._status.asObservable();
  private _processedData = new BehaviorSubject<ProcessedDistance[]>([]);
  public processedData$ = this._processedData.asObservable();
  private _eventName = new BehaviorSubject<string>('');
  public eventName$ = this._eventName.asObservable();
  private _errors = new BehaviorSubject<string[]>([]);
  public errors$ = this._errors.asObservable();
  private _lastDataReceived = new BehaviorSubject<number>(0);
  public lastDataReceived$ = this._lastDataReceived.asObservable();
  private _debugLog = new BehaviorSubject<DebugEntry[]>([]);
  public debugLog$ = this._debugLog.asObservable();
  private _groupThreshold = new BehaviorSubject<number>(this._loadThreshold());
  public groupThreshold$ = this._groupThreshold.asObservable();

  private _displayedGroups = new BehaviorSubject<Map<string, StandingsGroup[]>>(new Map());
  public displayedGroups$ = this._displayedGroups.asObservable();
  private _groupDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private _maxGroups = new BehaviorSubject<number>(this._loadMaxGroups());
  public maxGroups$ = this._maxGroups.asObservable();

  get groupThreshold(): number { return this._groupThreshold.value; }
  get maxGroups(): number { return this._maxGroups.value; }

  private _lapVariance = new BehaviorSubject<number>(this._loadLapVariance());
  get lapVarianceThreshold(): number { return this._lapVariance.value; }

  setLapVarianceThreshold(value: number) {
    const clamped = Math.max(0, Math.round(value));
    this._lapVariance.next(clamped);
    try { localStorage.setItem(STORAGE_KEY_LAP_VARIANCE, String(clamped)); } catch (e) { /* noop */ }
  }

  private _loadLapVariance(): number {
    try {
      const v = localStorage.getItem(STORAGE_KEY_LAP_VARIANCE);
      if (v !== null) return Math.max(0, parseInt(v, 10));
    } catch (e) { /* noop */ }
    return DEFAULT_LAP_VARIANCE;
  }

  private _showMassLapTimes = new BehaviorSubject<boolean>(this._loadShowLapTimes());
  get showMassStartLapTimes(): boolean { return this._showMassLapTimes.value; }

  setShowMassStartLapTimes(value: boolean) {
    this._showMassLapTimes.next(value);
    try { localStorage.setItem(STORAGE_KEY_SHOW_LAP_TIMES, String(value)); } catch (e) { /* noop */ }
  }

  private _loadShowLapTimes(): boolean {
    try {
      const v = localStorage.getItem(STORAGE_KEY_SHOW_LAP_TIMES);
      if (v !== null) return v !== 'false';
    } catch (e) { /* noop */ }
    return true;
  }

  setGroupThreshold(value: number) {
    const clamped = Math.min(MAX_GROUP_THRESHOLD, Math.max(0, value));
    this._groupThreshold.next(clamped);
    try { localStorage.setItem(STORAGE_KEY_THRESHOLD, String(clamped)); } catch (e) { /* noop */ }
    for (const dist of this.distanceMap.values()) {
      if (dist.isMassStart) this._recomputeGroups(dist);
    }
    // Flush debounce timers and immediately apply new groups
    for (const [distId, timer] of this._groupDebounceTimers) {
      clearTimeout(timer);
    }
    this._groupDebounceTimers.clear();
    this._flushDisplayedGroups();
    this.ngZone.run(() => this._publishState());
  }

  setMaxGroups(value: number) {
    const clamped = Math.max(0, Math.round(value));
    this._maxGroups.next(clamped);
    try { localStorage.setItem(STORAGE_KEY_MAX_GROUPS, String(clamped)); } catch (e) { /* noop */ }
    for (const dist of this.distanceMap.values()) {
      if (dist.isMassStart) this._recomputeGroups(dist);
    }
    for (const timer of this._groupDebounceTimers.values()) clearTimeout(timer);
    this._groupDebounceTimers.clear();
    this._flushDisplayedGroups();
    this.ngZone.run(() => this._publishState());
  }

  private _loadMaxGroups(): number {
    try {
      const v = localStorage.getItem(STORAGE_KEY_MAX_GROUPS);
      if (v !== null) return Math.max(0, parseInt(v, 10));
    } catch (e) { /* noop */ }
    return DEFAULT_MAX_GROUPS;
  }

  private _loadThreshold(): number {
    try {
      const v = localStorage.getItem(STORAGE_KEY_THRESHOLD);
      if (v !== null) return parseFloat(v);
    } catch (e) { /* noop */ }
    return DEFAULT_GROUP_THRESHOLD;
  }

  private distanceMap = new Map<string, ProcessedDistance>();
  private competitorMap = new Map<string, Map<string, CompetitorUpdate>>();
  private queue: any[] = [];
  private renderLoopRunning = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private ngZone: NgZone, private http: HttpClient) {
    this.connect();
  }

  // Management API methods
  manageGet(path: string, apiKey: string) {
    return this.http.get(`${this.BACKEND_HTTP_URL}/manage/${path}`, {
      headers: { 'x-api-key': apiKey }
    });
  }

  managePost(path: string, apiKey: string, body: any) {
    return this.http.post(`${this.BACKEND_HTTP_URL}/manage/${path}`, body, {
      headers: { 'x-api-key': apiKey }
    });
  }

  connect() {
    if (this.socket$ && !this.socket$.closed) return;
    this._errors.next([]);
    this._status.next({ status: 'Connecting...', url: '', interval: null });
    this.socket$ = webSocket({ url: this.BACKEND_URL, openObserver: { next: () => {} } });
    this.socket$.subscribe({
      next: (msg: any) => this._enqueue(msg),
      error: (err: any) => this._handleError(err),
      complete: () => this._handleDisconnect(),
    });
  }

  disconnect() {
    this._cancelReconnect();
    this.socket$?.complete();
    this.socket$ = null;
    this._status.next({ status: 'Disconnected', url: '', interval: null });
  }

  resetDashboard() {
    localStorage.clear();
    window.location.reload();
  }

  private _enqueue(msg: any) {
    this.queue.push(msg);
    if (!this.renderLoopRunning) {
      this.renderLoopRunning = true;
      this.ngZone.runOutsideAngular(() => this._scheduleNextCycle());
    }
  }

  private _scheduleNextCycle() {
    setTimeout(() => this._runCycle(), 0);
  }

  private _runCycle() {
    if (this.queue.length === 0) { this.renderLoopRunning = false; return; }
    const deadline = Date.now() + RENDER_INTERVAL_MS;
    let changed = false;
    while (this.queue.length > 0 && Date.now() < deadline) {
      changed = this._applyMessage(this.queue.shift()) || changed;
    }
    if (changed) {
      // Flush groups immediately so the strip renders on initial load
      // (debounce will still update it again after the threshold delay)
      this._flushDisplayedGroups();
      this.ngZone.run(() => this._publishState());
    }
    if (this.queue.length > 0) this._scheduleNextCycle();
    else this.renderLoopRunning = false;
  }

  private _applyMessage(msg: any): boolean {
    switch (msg.type) {
      case 'status':
        this._cancelReconnect();
        this.clearErrors();
        this.ngZone.run(() => this._status.next({
          status: 'Connected',
          url: msg.data.data_source_url,
          interval: msg.data.data_source_interval,
        }));
        return false;
      case 'event_name':
        this.ngZone.run(() => this._eventName.next(msg.data.name));
        return false;
      case 'error':
        this.ngZone.run(() => this.addError(msg.data));
        return false;
      case 'distance_meta':
        return this._applyDistanceMeta(msg.data as DistanceMeta);
      case 'competitor_update':
        return this._applyCompetitorUpdate(msg.data as CompetitorUpdate);
      default:
        return false;
    }
  }

  private _applyDistanceMeta(meta: DistanceMeta): boolean {
    let dist = this.distanceMap.get(meta.id);
    if (!dist) {
      dist = {
        id: meta.id, name: meta.name, eventNumber: meta.event_number,
        isLive: meta.is_live, isMassStart: meta.is_mass_start,
        distanceMeters: meta.distance_meters, totalLaps: meta.total_laps,
        anyFinished: meta.any_finished, finishingLineAfter: null,
        processedRaces: [], standingsGroups: [], heatGroups: [],
      };
      this.distanceMap.set(meta.id, dist);
    } else {
      dist.name = meta.name; dist.eventNumber = meta.event_number;
      dist.isLive = meta.is_live; dist.isMassStart = meta.is_mass_start;
      dist.distanceMeters = meta.distance_meters; dist.totalLaps = meta.total_laps;
      dist.anyFinished = meta.any_finished;
      // finishingLineAfter is intentionally NOT updated from the backend here;
      // it is computed instantly by _recomputeFinishingLine on every competitor update.
    }
    dist.heatGroups = meta.heat_groups.map(hg => ({
      heat: hg.heat,
      raceIds: hg.race_ids,
      races: this._resolveRaces(meta.id, hg.race_ids, !meta.is_mass_start),
    }));
    return true;
  }

  private _applyCompetitorUpdate(comp: CompetitorUpdate): boolean {
    comp.lastUpdated = Date.now();
    this._lastDataReceived.next(comp.lastUpdated);
    let distComps = this.competitorMap.get(comp.distance_id);
    if (!distComps) { distComps = new Map(); this.competitorMap.set(comp.distance_id, distComps); }

    const dist = this.distanceMap.get(comp.distance_id);
    if (dist) {
      const existing = distComps.get(comp.id);

      // Ensure frontend-only fields are preserved / initialised
      comp.position = existing?.position ?? 0;
      comp.position_change = null;
      comp.is_final_lap = false;
      comp.group_number = existing?.group_number ?? null;
      comp.gap_to_above = existing?.gap_to_above ?? null;
      comp.is_personal_record = false;

      // Update the competitor object in-place so the flash animation plays
      // at the competitor's CURRENT row position.
      if (existing) {
        Object.assign(existing, comp);
      } else {
        distComps.set(comp.id, comp);
        dist.processedRaces = [...dist.processedRaces, comp];
      }

      // Derive is_final_lap in the frontend
      const target = distComps.get(comp.id)!;
      target.is_final_lap = target.laps_remaining === 1;

      // Derive is_personal_record: finished timed competitor with time < PR
      if (!dist.isMassStart && target.total_time && target.personal_record) {
        target.is_personal_record =
          this._parseSeconds(target.total_time) < this._parseSeconds(target.personal_record);
      } else {
        target.is_personal_record = false;
      }

      // Recompute positions and resort immediately — before highlight and finishing line
      this._recomputePositions(distComps);
      dist.processedRaces = Array.from(distComps.values()).sort((a, b) => a.position - b.position);

      // Set finishing line to this competitor; persists until the next update moves it
      dist.finishingLineAfter = comp.id;

      if (dist.isMassStart) {
        this._recomputeGroups(dist);
        this._scheduleGroupDebounce(comp.distance_id);
      } else {
        dist.heatGroups.forEach(hg => {
          hg.races = this._resolveRaces(comp.distance_id, hg.raceIds, true);
        });
      }
    } else {
      comp.position = 0;
      comp.position_change = null;
      comp.is_final_lap = false;
      distComps.set(comp.id, comp);
    }

    // Append to debug log
    const debugLog = this._debugLog.value;
    if (debugLog.length >= MAX_DEBUG_ENTRIES) debugLog.splice(0, debugLog.length - MAX_DEBUG_ENTRIES);
    const distName = this.distanceMap.get(comp.distance_id)?.name ?? comp.distance_id;
    const currentLapTime = comp.lap_times?.length
      ? comp.lap_times[comp.lap_times.length - 1]
      : '';
    debugLog.push({
      timestamp: Date.now(),
      name: comp.name,
      startNumber: comp.start_number,
      distanceId: comp.distance_id,
      distanceName: distName,
      lapsCount: comp.laps_count,
      currentLapTime,
      formattedTotalTime: comp.formatted_total_time,
    });
    this._debugLog.next(debugLog);

    return true;
  }

  /** Sorts all competitors for a distance and assigns position + position_change. */
  private _recomputePositions(distComps: Map<string, CompetitorUpdate>) {
    const all = Array.from(distComps.values());
    all.sort((a, b) => {
      if (b.laps_count !== a.laps_count) return b.laps_count - a.laps_count;
      if (!a.total_time && !b.total_time) return 0;
      if (!a.total_time) return 1;
      if (!b.total_time) return -1;
      return this._parseSeconds(a.total_time) - this._parseSeconds(b.total_time);
    });
    all.forEach((r, i) => {
      const newPos = i + 1;
      if (r.position && r.position !== newPos) {
        r.position_change = newPos < r.position ? 'up' : 'down';
      } else {
        r.position_change = null;
      }
      r.position = newPos;
    });
  }


  private _timeDiff(a: string, b: string): number {
    if (!a || !b) return 9999;
    return Math.abs(this._parseSeconds(a) - this._parseSeconds(b));
  }

  parseSeconds(t: string): number { return this._parseSeconds(t); }

  private _parseSeconds(t: string): number {
    const parts = t.split(':');
    if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]);
  }

  private _recomputeGroups(dist: ProcessedDistance) {
    const threshold = this._groupThreshold.value;
    const maxG = this._maxGroups.value;
    dist.processedRaces.forEach(r => { r.group_number = null; r.gap_to_above = null; });

    // maxGroups = 0 means hide the group strip and all separators entirely
    if (maxG === 0) {
      dist.standingsGroups = [];
      return;
    }

    const unfinished = dist.processedRaces.filter(r => r.finished_rank == null && r.total_time);


    let groups: { laps: number; races: CompetitorUpdate[] }[] = [];
    let cur: { laps: number; races: CompetitorUpdate[] } | null = null;

    for (const r of unfinished) {
      if (!cur) {
        cur = { laps: r.laps_count, races: [r] };
        groups.push(cur);
      } else if (
        r.laps_count === cur.laps &&
        this._timeDiff(cur.races[cur.races.length - 1].total_time, r.total_time) <= threshold
      ) {
        cur.races.push(r);
      } else {
        cur = { laps: r.laps_count, races: [r] };
        groups.push(cur);
      }
    }

    const leaderTime = groups[0]?.races[0]?.total_time ?? null;

    dist.standingsGroups = groups.map((group, gi) => {
      const gnum = gi + 1;
      group.races.forEach((r, ri) => {
        r.group_number = gnum;
        if (ri === 0) {
          r.gap_to_above = null;
        } else {
          const leader = group.races[0];
          const lapDiff = leader.laps_count - r.laps_count;
          if (lapDiff > 0 || !r.total_time || !leader.total_time) {
            const diff = lapDiff > 0 ? lapDiff : 1;
            r.gap_to_above = `+${diff} lap${diff === 1 ? '' : 's'}`;
          } else {
            r.gap_to_above = `+${this._timeDiff(leader.total_time, r.total_time).toFixed(3)}s`;
          }
        }
      });

      const first = group.races[0];
      let gapToGroupAhead: string | null = null;
      let timeBehindLeader: string | null = null;

      if (gi > 0) {
        const prevGroup = groups[gi - 1];
        const prevLast = prevGroup.races[prevGroup.races.length - 1];
        const lapDiff = groups[0].laps - group.laps;
        if (lapDiff > 0) {
          // Behind the leader by at least one lap: express gap in laps vs leader
          gapToGroupAhead = `+${lapDiff} lap${lapDiff === 1 ? '' : 's'}`;
        } else if (prevLast.total_time && first.total_time) {
          gapToGroupAhead = `+${this._timeDiff(prevLast.total_time, first.total_time).toFixed(3)}s`;
        }
        if (leaderTime && first.total_time) {
          timeBehindLeader = `+${this._timeDiff(leaderTime, first.total_time).toFixed(3)}s`;
        }
      }

      return {
        groupNumber: gnum,
        laps: group.laps,
        leaderTime: first.total_time ? first.formatted_total_time : null,
        gapToGroupAhead,
        timeBehindLeader,
        isLastGroup: false,
        isOthers: false,
        races: group.races,
      } as StandingsGroup;
    });

    if (dist.standingsGroups.length > 0) {
      dist.standingsGroups[dist.standingsGroups.length - 1].isLastGroup = true;
    }

    // Collect overflow competitors into synthetic Others group
    if (maxG > 0 && dist.standingsGroups.length > maxG) {
      const overflowGroups = dist.standingsGroups.slice(maxG);
      const othersRaces = overflowGroups.flatMap(g => g.races);
      dist.standingsGroups = dist.standingsGroups.slice(0, maxG);
      dist.standingsGroups[dist.standingsGroups.length - 1].isLastGroup = false;

      // Recompute gap_to_above for all overflow races relative to the overflow leader
      const othersLeader = othersRaces[0];
      othersRaces.forEach((r, ri) => {
        if (ri === 0) {
          r.gap_to_above = null;
        } else {
          const lapDiff = (othersLeader?.laps_count ?? 0) - r.laps_count;
          if (lapDiff > 0) {
            r.gap_to_above = `+${lapDiff} lap${lapDiff === 1 ? '' : 's'}`;
          } else if (othersLeader?.total_time && r.total_time) {
            r.gap_to_above = `+${this._timeDiff(othersLeader.total_time, r.total_time).toFixed(3)}s`;
          } else {
            r.gap_to_above = null;
          }
        }
      });

      // Compute lap deficit of the tail group leader vs the first (head) group
      const headLaps = groups[0]?.laps ?? 0;
      const tailLaps = othersRaces[0]?.laps_count ?? 0;
      const tailLapDiff = headLaps - tailLaps;
      const tailGap = tailLapDiff >= 1
        ? `+${tailLapDiff} lap${tailLapDiff === 1 ? '' : 's'}`
        : null;

      dist.standingsGroups.push({
        groupNumber: maxG + 1,
        laps: tailLaps,
        leaderTime: null,
        gapToGroupAhead: tailGap,
        timeBehindLeader: null,
        isLastGroup: true,
        isOthers: true,
        races: othersRaces,
      });
    }
  }

  private _scheduleGroupDebounce(distId: string) {
    const existing = this._groupDebounceTimers.get(distId);
    if (existing) clearTimeout(existing);
    const thresholdMs = this._groupThreshold.value * 1000;
    const timer = setTimeout(() => {
      this._groupDebounceTimers.delete(distId);
      this._flushDisplayedGroups();
    }, thresholdMs);
    this._groupDebounceTimers.set(distId, timer);
  }

  private _flushDisplayedGroups() {
    const map = new Map<string, StandingsGroup[]>();
    for (const [id, dist] of this.distanceMap) {
      if (dist.isMassStart) map.set(id, dist.standingsGroups);
    }
    this.ngZone.run(() => this._displayedGroups.next(map));
  }

  private _resolveRaces(distId: string, ids: string[], pinnedByLane = false): (CompetitorUpdate | null)[] {
    const distComps = this.competitorMap.get(distId);
    if (!distComps) return pinnedByLane ? Array(LANE_ORDER_KEYS.length).fill(null) : [];
    const resolved = ids.map(id => distComps.get(id)).filter((c): c is CompetitorUpdate => !!c);
    if (!pinnedByLane) return resolved;
    // Build fixed-slot array: one slot per known lane in LANE_ORDER_KEYS
    const slots: (CompetitorUpdate | null)[] = LANE_ORDER_KEYS.map(lane =>
      resolved.find(c => c.lane?.toLowerCase() === lane) ?? null
    );
    // Append any competitors whose lane is not in LANE_ORDER
    const extra = resolved.filter(c => !(c.lane?.toLowerCase() in LANE_ORDER));
    return [...slots, ...extra];
  }

  private _publishState() {
    const distances = Array.from(this.distanceMap.values())
      .sort((a, b) => b.eventNumber - a.eventNumber);
    this._processedData.next(distances);
  }


  addError(msg: string) {
    this._errors.next([...this._errors.value, msg]);
  }

  dismissError(index: number) {
    const current = [...this._errors.value];
    current.splice(index, 1);
    this._errors.next(current);
  }

  clearErrors() {
    this._errors.next([]);
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private _cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _handleError(err: any) {
    console.error('WebSocket error:', err);
    this.addError('Connection to backend lost. Reconnecting in 5s…');
    this.socket$ = null;
    this._status.next({ status: 'Error', url: '', interval: null });
    this._scheduleReconnect();
  }

  private _handleDisconnect() {
    if (
      this._status.value.status === 'Connected' ||
      this._status.value.status === 'Connecting...'
    ) {
      this.addError('Connection to backend lost. Reconnecting in 5s…');
    }
    this.socket$ = null;
    this._status.next({ status: 'Disconnected', url: '', interval: null });
    this._scheduleReconnect();
  }
}
