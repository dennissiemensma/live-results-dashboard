import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { BehaviorSubject } from 'rxjs';
import { LiveData, ProcessedDistance, ProcessedRace, Distance, HeatGroup, StandingsGroup } from '../models/data.models';

export interface BackendStatus {
  status: 'Disconnected' | 'Connecting...' | 'Connected' | 'Error';
  url: string;
  interval: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private socket$: WebSocketSubject<any> | null = null;
  private readonly BACKEND_URL = `ws://${window.location.hostname}:5000/ws`;

  private _status = new BehaviorSubject<BackendStatus>({
    status: 'Disconnected',
    url: '',
    interval: null
  });
  public status$ = this._status.asObservable();

  private _processedData = new BehaviorSubject<ProcessedDistance[]>([]);
  public processedData$ = this._processedData.asObservable();

  private _eventName = new BehaviorSubject<string>('');
  public eventName$ = this._eventName.asObservable();

  private _errors = new BehaviorSubject<string[]>([]);
  public errors$ = this._errors.asObservable();

  private _lastDataReceived = new BehaviorSubject<number>(0);
  public lastDataReceived$ = this._lastDataReceived.asObservable();

  constructor() {
    // Auto-connect on service init (page load)
    this.connect();
  }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleReconnect() {
    if (this.reconnectTimer) return; // already scheduled
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  connect() {
    if (this.socket$ && !this.socket$.closed) return;

    // Keep localStorage — do not wipe
    this._errors.next([]);
    this._status.next({ status: 'Connecting...', url: '', interval: null });
    this.socket$ = webSocket({ url: this.BACKEND_URL, openObserver: { next: () => {} } });

    this.socket$.subscribe({
      next: (msg: any) => this.handleMessage(msg),
      error: (err) => this.handleError(err),
      complete: () => this.handleDisconnect()
    });
  }

  disconnect() {
    this.cancelReconnect();
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = null;
    }
    this._status.next({ status: 'Disconnected', url: '', interval: null });
  }

  /** Clear local storage and reload the page */
  resetDashboard() {
    localStorage.clear();
    window.location.reload();
  }

  private handleMessage(msg: any) {
    if (msg.type === 'status') {
      this.cancelReconnect();
      this.clearErrors(); // clear any "connection lost" errors on successful reconnect
      this._status.next({
        status: 'Connected',
        url: msg.data.data_source_url,
        interval: msg.data.data_source_interval
      });
    } else if (msg.type === 'data') {
      const data = msg.data as LiveData;
      if (data.success === false) {
        this.addError('Received update with success=false');
      } else {
        this._eventName.next(data.name);
        this._lastDataReceived.next(Date.now());
        this.processData(data.distances);
      }
    }
  }

  private processData(distances: Distance[]) {
    const processedDistances: ProcessedDistance[] = distances.map(distance => {

      // Mass start: over 2 races AND all have the same heat
      let isMassStart = false;
      if (distance.races && distance.races.length > 2) {
        const firstHeat = distance.races[0].heat;
        isMassStart = distance.races.every(r => r.heat === firstHeat);
      }

      // Extract distance in meters or total laps from the title
      let distanceMeters: number | undefined;
      let totalLaps: number | undefined;
      if (isMassStart) {
        const lapsMatch = distance.name.match(/(\d+)\s*(?:laps?|ronden?|rondes?)/i);
        if (lapsMatch) totalLaps = parseInt(lapsMatch[1], 10);
      } else {
        const metersMatch = distance.name.match(/(\d+)\s*(?:m\b|meter)/i);
        if (metersMatch) distanceMeters = parseInt(metersMatch[1], 10);
      }

      const processedRaces: ProcessedRace[] = distance.races.map(race => {
        let laps = race.laps ? [...race.laps] : [];

        // Mass start: omit the first lap (warmup/dummy lap)
        if (isMassStart && laps.length > 0) {
          laps = laps.slice(1);
        }

        // Total time = highest time value among laps
        let maxTime: string | null = null;
        let formattedTime: string = 'No Time';
        const lapTimes: string[] = [];

        if (laps.length > 0) {
          const sortedLaps = [...laps].sort((a, b) => a.time.localeCompare(b.time));
          maxTime = sortedLaps[sortedLaps.length - 1].time;
          if (maxTime) formattedTime = this.formatTime(maxTime);
          lapTimes.push(...laps.map(l => l.lapTime ? this.formatTime(l.lapTime) : ''));
        }

        // Mass start: black badges; non-mass-start: lane color
        const lane = isMassStart ? 'black' : (race.lane || 'black');

        const newRace: ProcessedRace = {
          id: race.id,
          competitorName: race.competitor.name,
          startNumber: race.competitor.startNumber,
          lane,
          heat: race.heat,
          lapsCount: laps.length,
          totalTime: maxTime || '',
          formattedTotalTime: formattedTime,
          lapTimes,
          lastUpdated: 0
        };

        // Compare with localStorage to detect time/lap updates
        const storedKey = `race_${race.id}`;
        const storedRaceJson = localStorage.getItem(storedKey);
        if (storedRaceJson) {
          const storedRace = JSON.parse(storedRaceJson) as ProcessedRace;
          if (storedRace.totalTime !== newRace.totalTime || storedRace.lapsCount !== newRace.lapsCount) {
            newRace.lastUpdated = Date.now();
          } else {
            newRace.lastUpdated = storedRace.lastUpdated;
          }
        }
        localStorage.setItem(storedKey, JSON.stringify(newRace));
        return newRace;
      });

      // Sort races: laps descending, then total time ascending
      processedRaces.sort((a, b) => {
        if (b.lapsCount !== a.lapsCount) return b.lapsCount - a.lapsCount;
        const timeA = a.totalTime || '99:99:99';
        const timeB = b.totalTime || '99:99:99';
        return timeA.localeCompare(timeB);
      });

      // Detect position changes (overall list)
      processedRaces.forEach((race, newIndex) => {
        const posKey = `pos_${distance.id}_${race.id}`;
        const storedPos = localStorage.getItem(posKey);
        if (storedPos !== null) {
          const prevIndex = parseInt(storedPos, 10);
          race.positionChange = newIndex < prevIndex ? 'up' : newIndex > prevIndex ? 'down' : null;
        } else {
          race.positionChange = null;
        }
        localStorage.setItem(posKey, String(newIndex));
      });

      let heatGroups: HeatGroup[] | undefined;
      let standingsGroups: StandingsGroup[] | undefined;

      if (!isMassStart) {
        const heatMap = new Map<number, ProcessedRace[]>();
        for (const race of processedRaces) {
          if (!heatMap.has(race.heat)) heatMap.set(race.heat, []);
          heatMap.get(race.heat)!.push(race);
        }
        const sortedHeats = Array.from(heatMap.keys()).sort((a, b) => a - b);
        heatGroups = sortedHeats.map(heat => {
          const races = heatMap.get(heat)!;
          races.sort((a, b) => {
            if (!a.totalTime && !b.totalTime) return 0;
            if (!a.totalTime) return 1;
            if (!b.totalTime) return -1;
            return a.totalTime.localeCompare(b.totalTime);
          });
          races.forEach((race, newIndex) => {
            const posKey = `pos_${distance.id}_heat${heat}_${race.id}`;
            const storedPos = localStorage.getItem(posKey);
            if (storedPos !== null) {
              const prevIndex = parseInt(storedPos, 10);
              race.positionChange = newIndex < prevIndex ? 'up' : newIndex > prevIndex ? 'down' : null;
            } else {
              race.positionChange = null;
            }
            localStorage.setItem(posKey, String(newIndex));
          });
          return { heat, races };
        });
      } else {
        const groups: StandingsGroup[] = [];
        let currentGroup: StandingsGroup | null = null;
        for (const race of processedRaces) {
          if (!currentGroup) {
            currentGroup = { laps: race.lapsCount, races: [race] };
            groups.push(currentGroup);
          } else if (race.lapsCount === currentGroup.laps) {
            const lastRace = currentGroup.races[currentGroup.races.length - 1];
            const diff = this.getTimeDifferenceInSeconds(lastRace.totalTime, race.totalTime);
            if (diff <= 2.0) {
              currentGroup.races.push(race);
            } else {
              currentGroup = { laps: race.lapsCount, races: [race] };
              groups.push(currentGroup);
            }
          } else {
            currentGroup = { laps: race.lapsCount, races: [race] };
            groups.push(currentGroup);
          }
        }

        for (const group of groups) {
          group.races.sort((a, b) => {
            if (!a.totalTime && !b.totalTime) return 0;
            if (!a.totalTime) return 1;
            if (!b.totalTime) return -1;
            return a.totalTime.localeCompare(b.totalTime);
          });
        }

        const overallLeaderTime = groups.length > 0 && groups[0].races.length > 0
          ? groups[0].races[0].totalTime : null;

        for (let gi = 0; gi < groups.length; gi++) {
          const group = groups[gi];
          if (group.races.length > 0 && group.races[0].totalTime) {
            group.leaderTime = group.races[0].formattedTotalTime;
          }
          for (let ri = 1; ri < group.races.length; ri++) {
            const prev = group.races[ri - 1];
            const curr = group.races[ri];
            if (prev.totalTime && curr.totalTime) {
              const diff = this.getTimeDifferenceInSeconds(prev.totalTime, curr.totalTime);
              curr.gapToAbove = `+${diff.toFixed(3)}`;
            }
          }
          if (gi > 0) {
            const prevGroup = groups[gi - 1];
            const lastOfPrev = prevGroup.races[prevGroup.races.length - 1];
            const firstOfCurr = group.races[0];
            if (lastOfPrev.totalTime && firstOfCurr.totalTime) {
              const diff = this.getTimeDifferenceInSeconds(lastOfPrev.totalTime, firstOfCurr.totalTime);
              group.gapToPreviousGroup = `+${diff.toFixed(3)}`;
            }
            if (overallLeaderTime && firstOfCurr.totalTime) {
              const behind = this.getTimeDifferenceInSeconds(overallLeaderTime, firstOfCurr.totalTime);
              group.timeBehindLeader = `+${behind.toFixed(3)}s`;
            }
          }
        }
        standingsGroups = groups;
      }

      return {
        ...distance,
        isMassStart,
        distanceMeters,
        totalLaps,
        processedRaces,
        heatGroups,
        standingsGroups
      } as ProcessedDistance;
    });

    this._processedData.next(processedDistances);
  }

  // Format time: strip leading zeros, truncate to 3 decimal places
  // e.g. 00:01:23.4560000 -> 1:23.456
  formatTime(timeStr: string): string {
    if (!timeStr) return '';
    const colonParts = timeStr.split(':');
    const resultParts: string[] = [];
    let foundNonZero = false;
    for (let i = 0; i < colonParts.length; i++) {
      const part = colonParts[i];
      const isLast = i === colonParts.length - 1;
      if (isLast) {
        const dotIdx = part.indexOf('.');
        if (dotIdx !== -1) {
          let intPart = part.substring(0, dotIdx);
          let decPart = part.substring(dotIdx + 1);
          if (decPart.length > 3) decPart = decPart.substring(0, 3);
          if (!foundNonZero) intPart = intPart.replace(/^0+/, '') || '0';
          resultParts.push(intPart + '.' + decPart);
        } else {
          let intPart = part;
          if (!foundNonZero) intPart = intPart.replace(/^0+/, '') || '0';
          resultParts.push(intPart);
        }
      } else {
        const numVal = parseInt(part, 10);
        if (!foundNonZero && numVal === 0) continue;
        foundNonZero = true;
        resultParts.push(String(numVal));
      }
    }
    return resultParts.join(':');
  }

  private getTimeDifferenceInSeconds(timeA: string, timeB: string): number {
    if (!timeA || !timeB) return 9999;
    const toSeconds = (t: string) => {
      const parts = t.split(':');
      let s = 0;
      if (parts.length === 3) { s += parseInt(parts[0]) * 3600; s += parseInt(parts[1]) * 60; s += parseFloat(parts[2]); }
      else if (parts.length === 2) { s += parseInt(parts[0]) * 60; s += parseFloat(parts[1]); }
      else { s += parseFloat(parts[0]); }
      return s;
    };
    return Math.abs(toSeconds(timeA) - toSeconds(timeB));
  }

  private handleError(err: any) {
    console.error('WebSocket error:', err);
    this.addError('Connection to backend lost. Reconnecting in 5s…');
    this.socket$ = null;
    this._status.next({ status: 'Error', url: '', interval: null });
    this.scheduleReconnect();
  }

  private handleDisconnect() {
    if (this._status.value.status === 'Connected' || this._status.value.status === 'Connecting...') {
      this.addError('Connection to backend lost. Reconnecting in 5s…');
    }
    this.socket$ = null;
    this._status.next({ status: 'Disconnected', url: '', interval: null });
    this.scheduleReconnect();
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
}
