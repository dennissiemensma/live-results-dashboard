import { Injectable, NgZone } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { BehaviorSubject } from 'rxjs';
import {
  DistanceMeta,
  CompetitorUpdate,
  ProcessedDistance,
} from '../models/data.models';

export interface BackendStatus {
  status: 'Disconnected' | 'Connecting...' | 'Connected' | 'Error';
  url: string;
  interval: number | null;
}

/** Max time (ms) spent processing queued messages per render cycle. */
const RENDER_INTERVAL_MS = 250;

@Injectable({ providedIn: 'root' })
export class DataService {
  private socket$: WebSocketSubject<any> | null = null;
  private readonly BACKEND_URL = `ws://${window.location.hostname}:5000/ws`;

  // ── public observables ───────────────────────────────────────────────────
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

  // ── internal state ───────────────────────────────────────────────────────
  /** Map of distance id → ProcessedDistance (mutable local state) */
  private distanceMap = new Map<string, ProcessedDistance>();
  /** Map of distance id → Map of competitor id → CompetitorUpdate */
  private competitorMap = new Map<string, Map<string, CompetitorUpdate>>();

  /** Incoming message queue */
  private queue: any[] = [];
  private renderLoopRunning = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private ngZone: NgZone) {
    this._restoreFromStorage();
    this.connect();
  }

  // ── connection ────────────────────────────────────────────────────────────

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

  // ── message queue & render loop ───────────────────────────────────────────

  private _enqueue(msg: any) {
    this.queue.push(msg);
    if (!this.renderLoopRunning) {
      this.renderLoopRunning = true;
      // Run outside Angular zone so setTimeout doesn't trigger extra CD cycles
      this.ngZone.runOutsideAngular(() => this._scheduleNextCycle());
    }
  }

  private _scheduleNextCycle() {
    setTimeout(() => this._runCycle(), 0);
  }

  private _runCycle() {
    if (this.queue.length === 0) {
      this.renderLoopRunning = false;
      return;
    }

    const deadline = Date.now() + RENDER_INTERVAL_MS;
    let changed = false;

    while (this.queue.length > 0 && Date.now() < deadline) {
      const msg = this.queue.shift();
      changed = this._applyMessage(msg) || changed;
    }

    if (changed) {
      // Re-enter Angular zone to trigger change detection
      this.ngZone.run(() => {
        this._publishState();
      });
    }

    if (this.queue.length > 0) {
      this._scheduleNextCycle();
    } else {
      this.renderLoopRunning = false;
    }
  }

  // ── message handlers ──────────────────────────────────────────────────────

  /** Apply one message to local state. Returns true if view state changed. */
  private _applyMessage(msg: any): boolean {
    switch (msg.type) {
      case 'status':
        this._cancelReconnect();
        this.clearErrors();
        this.ngZone.run(() => {
          this._status.next({
            status: 'Connected',
            url: msg.data.data_source_url,
            interval: msg.data.data_source_interval,
          });
        });
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
        id: meta.id,
        name: meta.name,
        eventNumber: meta.event_number,
        isLive: meta.is_live,
        isMassStart: meta.is_mass_start,
        distanceMeters: meta.distance_meters,
        totalLaps: meta.total_laps,
        anyFinished: meta.any_finished,
        finishingLineAfter: meta.finishing_line_after,
        processedRaces: [],
        standingsGroups: [],
        heatGroups: [],
      };
      this.distanceMap.set(meta.id, dist);
    } else {
      dist.name = meta.name;
      dist.eventNumber = meta.event_number;
      dist.isLive = meta.is_live;
      dist.isMassStart = meta.is_mass_start;
      dist.distanceMeters = meta.distance_meters;
      dist.totalLaps = meta.total_laps;
      dist.anyFinished = meta.any_finished;
      dist.finishingLineAfter = meta.finishing_line_after;
    }

    // Resolve standings groups (races populated later from competitorMap)
    dist.standingsGroups = meta.standings_groups.map(sg => ({
      groupNumber: sg.group_number,
      laps: sg.laps,
      leaderTime: sg.leader_time,
      gapToGroupAhead: sg.gap_to_group_ahead,
      timeBehindLeader: sg.time_behind_leader,
      isLastGroup: sg.is_last_group,
      races: this._resolveRaces(meta.id, sg.race_ids),
    }));

    dist.heatGroups = meta.heat_groups.map(hg => ({
      heat: hg.heat,
      races: this._resolveRaces(meta.id, hg.race_ids),
    }));

    this._saveDistanceToStorage(dist);
    return true;
  }

  private _applyCompetitorUpdate(comp: CompetitorUpdate): boolean {
    comp.lastUpdated = Date.now();
    this._lastDataReceived.next(comp.lastUpdated);

    let distComps = this.competitorMap.get(comp.distance_id);
    if (!distComps) {
      distComps = new Map();
      this.competitorMap.set(comp.distance_id, distComps);
    }
    distComps.set(comp.id, comp);
    this._saveCompetitorToStorage(comp);

    // Rebuild processedRaces for the distance (order by position from backend)
    const dist = this.distanceMap.get(comp.distance_id);
    if (dist) {
      const allComps = Array.from(distComps.values());
      allComps.sort((a, b) => a.position - b.position);
      dist.processedRaces = allComps;

      // Re-resolve group races now that competitor data is fresh
      dist.standingsGroups.forEach(sg => {
        sg.races = this._resolveRaces(comp.distance_id, sg.races.map(r => r.id));
      });
      dist.heatGroups.forEach(hg => {
        hg.races = this._resolveRaces(comp.distance_id, hg.races.map(r => r.id));
      });
    }
    return true;
  }

  private _resolveRaces(distId: string, ids: string[]): CompetitorUpdate[] {
    const distComps = this.competitorMap.get(distId);
    if (!distComps) return [];
    return ids.map(id => distComps.get(id)).filter((c): c is CompetitorUpdate => !!c);
  }

  // ── publish to observables ────────────────────────────────────────────────

  private _publishState() {
    const distances = Array.from(this.distanceMap.values())
      .sort((a, b) => b.eventNumber - a.eventNumber);
    this._processedData.next(distances);
  }

  // ── localStorage persistence ──────────────────────────────────────────────

  private _saveDistanceToStorage(dist: ProcessedDistance) {
    try {
      // Store only scalar meta — competitors stored separately
      const meta = { ...dist, processedRaces: [], standingsGroups: [], heatGroups: [] };
      localStorage.setItem(`dist_${dist.id}`, JSON.stringify(meta));
    } catch {}
  }

  private _saveCompetitorToStorage(comp: CompetitorUpdate) {
    try {
      localStorage.setItem(`comp_${comp.distance_id}_${comp.id}`, JSON.stringify(comp));
    } catch {}
  }

  private _restoreFromStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith('dist_')) {
          const dist: ProcessedDistance = JSON.parse(localStorage.getItem(key)!);
          dist.processedRaces = [];
          dist.standingsGroups = [];
          dist.heatGroups = [];
          this.distanceMap.set(dist.id, dist);
        }
      }
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith('comp_')) {
          const comp: CompetitorUpdate = JSON.parse(localStorage.getItem(key)!);
          let distComps = this.competitorMap.get(comp.distance_id);
          if (!distComps) {
            distComps = new Map();
            this.competitorMap.set(comp.distance_id, distComps);
          }
          distComps.set(comp.id, comp);
        }
      }
      // Rebuild processedRaces for each distance
      for (const [distId, dist] of this.distanceMap) {
        const comps = this.competitorMap.get(distId);
        if (comps) {
          dist.processedRaces = Array.from(comps.values()).sort((a, b) => a.position - b.position);
        }
      }
      this._publishState();
    } catch {}
  }

  // ── error helpers ─────────────────────────────────────────────────────────

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

  // ── reconnect ─────────────────────────────────────────────────────────────

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
    if (this._status.value.status === 'Connected' || this._status.value.status === 'Connecting...') {
      this.addError('Connection to backend lost. Reconnecting in 5s…');
    }
    this.socket$ = null;
    this._status.next({ status: 'Disconnected', url: '', interval: null });
    this._scheduleReconnect();
  }
}
