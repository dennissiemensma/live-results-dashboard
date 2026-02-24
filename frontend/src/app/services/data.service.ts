import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { BehaviorSubject } from 'rxjs';
import { Router } from '@angular/router';
import { LiveData, ProcessedDistance, ProcessedRace, Distance, HeatGroup, StandingsGroup } from '../models/data.models';

export interface BackendStatus {
  status: 'Disconnected' | 'Connecting...' | 'Connected';
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

  constructor(private router: Router) {}

  connect() {
    if (this.socket$ && !this.socket$.closed) return;

    // Wipe local storage on connect
    localStorage.clear();
    this._errors.next([]);

    this._status.next({ ...this._status.value, status: 'Connecting...' });
    this.socket$ = webSocket(this.BACKEND_URL);

    this.socket$.subscribe({
      next: (msg: any) => this.handleMessage(msg),
      error: (err) => this.handleError(err),
      complete: () => this.handleDisconnect()
    });
  }

  disconnect() {
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = null;
    }
    this.handleDisconnect();
  }

  private handleMessage(msg: any) {
    if (msg.type === 'status') {
      this._status.next({
        status: 'Connected',
        url: msg.data.data_source_url,
        interval: msg.data.data_source_interval
      });
      // Navigate only if not already on live page
      if (this.router.url !== '/live') {
        this.router.navigate(['/live']);
      }
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
          if (maxTime) {
            formattedTime = this.formatTime(maxTime);
          }
          lapTimes.push(...laps.map(l => l.lapTime ? this.formatTime(l.lapTime) : ''));
        }

        // For mass start, use black lane; otherwise use the actual lane color
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

        // Check local storage for previous version to track updates
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

      // Detect position changes by comparing new index to stored index
      processedRaces.forEach((race, newIndex) => {
        const posKey = `pos_${distance.id}_${race.id}`;
        const storedPos = localStorage.getItem(posKey);
        if (storedPos !== null) {
          const prevIndex = parseInt(storedPos, 10);
          if (newIndex < prevIndex) race.positionChange = 'up';
          else if (newIndex > prevIndex) race.positionChange = 'down';
          else race.positionChange = null;
        } else {
          race.positionChange = null;
        }
        localStorage.setItem(posKey, String(newIndex));
      });

      let heatGroups: HeatGroup[] | undefined;
      let standingsGroups: StandingsGroup[] | undefined;

      if (!isMassStart) {
        // Non-mass-start: group by heat, sort each group by total time ascending
        const heatMap = new Map<number, ProcessedRace[]>();
        for (const race of processedRaces) {
          if (!heatMap.has(race.heat)) heatMap.set(race.heat, []);
          heatMap.get(race.heat)!.push(race);
        }
        // Sort heats ascending
        const sortedHeats = Array.from(heatMap.keys()).sort((a, b) => a - b);
        heatGroups = sortedHeats.map(heat => {
          const races = heatMap.get(heat)!;
          // Within heat: sort by total time ascending (empty times last)
          races.sort((a, b) => {
            if (!a.totalTime && !b.totalTime) return 0;
            if (!a.totalTime) return 1;
            if (!b.totalTime) return -1;
            return a.totalTime.localeCompare(b.totalTime);
          });
          // Detect per-heat position changes
          races.forEach((race, newIndex) => {
            const posKey = `pos_${distance.id}_heat${heat}_${race.id}`;
            const storedPos = localStorage.getItem(posKey);
            if (storedPos !== null) {
              const prevIndex = parseInt(storedPos, 10);
              if (newIndex < prevIndex) race.positionChange = 'up';
              else if (newIndex > prevIndex) race.positionChange = 'down';
              else race.positionChange = null;
            } else {
              race.positionChange = null;
            }
            localStorage.setItem(posKey, String(newIndex));
          });
          return { heat, races };
        });
      } else {
        // Mass start: group by laps count, then by total time within 2 seconds of each other
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

        // For each group: sort by total time ascending, set leaderTime, compute intra-group gaps
        // Determine the overall race leader's time (first of first group, after sorting)
        // We'll do a first pass sort, then a second pass for gaps.
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

          // Leader time (first in group)
          if (group.races.length > 0 && group.races[0].totalTime) {
            group.leaderTime = group.races[0].formattedTotalTime;
          }

          // Intra-group gaps: each race gets a gapToAbove vs the one before it
          for (let ri = 1; ri < group.races.length; ri++) {
            const prev = group.races[ri - 1];
            const curr = group.races[ri];
            if (prev.totalTime && curr.totalTime) {
              const diff = this.getTimeDifferenceInSeconds(prev.totalTime, curr.totalTime);
              curr.gapToAbove = `+${diff.toFixed(3)}`;
            }
          }

          // Gap between groups
          if (gi > 0) {
            const prevGroup = groups[gi - 1];
            const lastOfPrev = prevGroup.races[prevGroup.races.length - 1];
            const firstOfCurr = group.races[0];
            if (lastOfPrev.totalTime && firstOfCurr.totalTime) {
              const diff = this.getTimeDifferenceInSeconds(lastOfPrev.totalTime, firstOfCurr.totalTime);
              group.gapToPreviousGroup = `+${diff.toFixed(3)}`;
            }

            // Total time behind the overall race leader
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
        processedRaces,
        heatGroups,
        standingsGroups
      } as ProcessedDistance;
    });

    this._processedData.next(processedDistances);
  }

  // Helper to format time: remove leading zeros, keep max 3 decimals (truncate, not round)
  // e.g. 00:01:23.4560000 -> 1:23.456
  formatTime(timeStr: string): string {
    if (!timeStr) return '';

    // Split into parts by ':'
    const colonParts = timeStr.split(':');
    const resultParts: string[] = [];

    let foundNonZero = false;
    for (let i = 0; i < colonParts.length; i++) {
      const part = colonParts[i];
      const isLast = i === colonParts.length - 1;

      if (isLast) {
        // Last part may contain decimals
        const dotIdx = part.indexOf('.');
        if (dotIdx !== -1) {
          let intPart = part.substring(0, dotIdx);
          let decPart = part.substring(dotIdx + 1);

          // Truncate decimals to 3
          if (decPart.length > 3) {
            decPart = decPart.substring(0, 3);
          }

          // Strip leading zeros from integer part if no prior parts
          if (!foundNonZero) {
            intPart = intPart.replace(/^0+/, '') || '0';
          }

          resultParts.push(intPart + '.' + decPart);
        } else {
          let intPart = part;
          if (!foundNonZero) {
            intPart = intPart.replace(/^0+/, '') || '0';
          }
          resultParts.push(intPart);
        }
      } else {
        // Non-last segment: skip leading zero-only segments
        const numVal = parseInt(part, 10);
        if (!foundNonZero && numVal === 0) {
          continue; // Skip leading zero segments
        }
        foundNonZero = true;
        resultParts.push(String(numVal)); // Remove leading zeros within segment
      }
    }

    return resultParts.join(':');
  }

  private getTimeDifferenceInSeconds(timeA: string, timeB: string): number {
    if (!timeA || !timeB) return 9999;

    const toSeconds = (t: string) => {
      const parts = t.split(':');
      let seconds = 0;
      if (parts.length === 3) {
        seconds += parseInt(parts[0]) * 3600;
        seconds += parseInt(parts[1]) * 60;
        seconds += parseFloat(parts[2]);
      } else if (parts.length === 2) {
        seconds += parseInt(parts[0]) * 60;
        seconds += parseFloat(parts[1]);
      } else {
        seconds += parseFloat(parts[0]);
      }
      return seconds;
    };

    return Math.abs(toSeconds(timeA) - toSeconds(timeB));
  }

  private handleError(err: any) {
    console.error('WebSocket error:', err);
    this.addError('Connection error occurred');
    this.socket$ = null;
    this.handleDisconnect();
  }

  private handleDisconnect() {
    this._status.next({
      status: 'Disconnected',
      url: '',
      interval: null
    });
    this._processedData.next([]);
    // Only navigate to dashboard if currently on the live page
    if (this.router.url === '/live') {
      this.router.navigate(['/']);
    }
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

  // Keep for backward compat
  clearError() {
    this.clearErrors();
  }
}
