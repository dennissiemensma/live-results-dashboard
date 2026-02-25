import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { DataService, DebugEntry } from '../../services/data.service';
import { ProcessedDistance, StandingsGroup, CompetitorUpdate } from '../../models/data.models';
import { Observable, combineLatest, timer, map, Subscription } from 'rxjs';
import {
  AccordionModule,
  AlertModule,
  BadgeModule,
  ButtonModule,
  CardModule,
  GridModule,
  SharedModule,
} from '@coreui/angular';
import {
  trigger,
  transition,
  style,
  animate,
  query,
  stagger,
  state,
} from '@angular/animations';

// raceListAnimation: tracks list identity changes so Angular re-applies
// per-row CSS classes (pos-up / pos-down) on reorder.
export const raceListAnimation = trigger('raceList', [
  transition('* => *', [
    query(':enter', [
      style({ opacity: 0 }),
      stagger(0, [animate('150ms ease-out', style({ opacity: 1 }))]),
    ], { optional: true }),
  ]),
]);

/**
 * Group card leave animations:
 *  'last'   — the tail group merged into the group ahead: slide right (toward head) + fade
 *  'normal' — a group was disbanded (members finished): fade out in place
 */
export const groupCardAnimation = trigger('groupCard', [
  state('last',   style({ opacity: 1, transform: 'translateX(0)' })),
  state('normal', style({ opacity: 1, transform: 'translateX(0)' })),
  // last group: slide toward head (right in the row-reversed strip) + fade
  transition('last => void', [
    animate('420ms cubic-bezier(0.4, 0, 0.2, 1)',
      style({ opacity: 0, transform: 'translateX(60px)' })),
  ]),
  // disbanded group: fade out in place
  transition('normal => void', [
    animate('350ms ease-in', style({ opacity: 0 })),
  ]),
]);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    AccordionModule,
    AlertModule,
    BadgeModule,
    ButtonModule,
    CardModule,
    GridModule,
    SharedModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  animations: [raceListAnimation, groupCardAnimation],
})
export class DashboardComponent implements OnInit, OnDestroy {
  sortedDistances$: Observable<ProcessedDistance[]>;
  eventName$: Observable<string>;
  errors$: Observable<string[]>;
  status$: Observable<import('../../services/data.service').BackendStatus>;
  secondsSinceUpdate$: Observable<number>;
  displayedGroups$: Observable<Map<string, StandingsGroup[]>>;

  initialLiveId: string | null = null;
  liveEventNumber: number | null = null;
  pulseActive = false;
  selectedRaceId: string | null = null;
  debugVisible = false;
  debugLog$: Observable<DebugEntry[]>;

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
  }


  selectRace(id: string): void {
    this.selectedRaceId = this.selectedRaceId === id ? null : id;
  }

  onThresholdChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    if (!isNaN(val)) this.dataService.setGroupThreshold(val);
  }

  onMaxGroupsChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(val)) this.dataService.setMaxGroups(val);
  }

  private pulseTimeout: ReturnType<typeof setTimeout> | null = null;
  private dataSub: Subscription | null = null;
  private titleSub: Subscription | null = null;

  constructor(public dataService: DataService, private titleService: Title) {
    this.status$ = this.dataService.status$;
    this.eventName$ = this.dataService.eventName$;
    this.errors$ = this.dataService.errors$;
    this.displayedGroups$ = this.dataService.displayedGroups$;
    this.debugLog$ = this.dataService.debugLog$;

    this.sortedDistances$ = this.dataService.processedData$.pipe(
      map((distances) => {
        if (!distances || distances.length === 0) return [];
        const sorted = [...distances].sort((a, b) => b.eventNumber - a.eventNumber);
        // Capture the first live distance id/eventNumber only once
        if (this.initialLiveId === null) {
          const live = sorted.find((d) => d.isLive);
          if (live) {
            this.initialLiveId = live.id;
            this.liveEventNumber = live.eventNumber;
          }
        }
        return sorted;
      }),
    );

    this.secondsSinceUpdate$ = combineLatest([
      this.dataService.lastDataReceived$,
      timer(0, 1000),
    ]).pipe(
      map(([lastReceived]) => {
        if (!lastReceived) return 0;
        return Math.floor((Date.now() - lastReceived) / 1000);
      }),
    );
  }

  ngOnInit() {
    this.titleSub = this.dataService.eventName$.subscribe(name => {
      this.titleService.setTitle(name ? `${name} | Live Results Dashboard` : 'Live Results Dashboard');
    });
    this.dataSub = this.dataService.lastDataReceived$.subscribe((ts) => {
      if (!ts) return;
      this.pulseActive = true;
      if (this.pulseTimeout) clearTimeout(this.pulseTimeout);
      this.pulseTimeout = setTimeout(() => (this.pulseActive = false), 2000);
    });
  }

  ngOnDestroy() {
    this.dataSub?.unsubscribe();
    this.titleSub?.unsubscribe();
    if (this.pulseTimeout) clearTimeout(this.pulseTimeout);
  }


  isRecentUpdate(timestamp: number | undefined): boolean {
    if (!timestamp) return false;
    return Date.now() - timestamp < 1000;
  }

  padStartNumber(n: string): string {
    return n ?? '';
  }

  badgeTextClass(lane: string): string {
    const light = ['white', 'yellow', 'orange', 'pink', 'lime'];
    return light.includes((lane || '').toLowerCase()) ? 'text-dark' : 'text-white';
  }

  splitFormattedTime(t: string): [string, string] {
    if (!t || t === 'No Time') return [t || '', ''];
    const dot = t.indexOf('.');
    if (dot === -1) return [t, ''];
    return [t.substring(0, dot), '.' + t.substring(dot + 1)];
  }

  /** Returns [base, superscript] for ordinal, e.g. ordinalSuffix(1) → ['1','st'] */
  ordinalSuffix(n: number): [string, string] {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return [String(n), s[(v - 20) % 10] ?? s[v] ?? s[0]];
  }

  /** Stable animation state key — changes whenever the sort order of the list changes. */
  raceListKey(races: { id: string }[]): string {
    return races.map(r => r.id).join(',');
  }

  /**
   * Returns true when the race at raceIdx is the first competitor of a new
   * standings group (different lapsCount from the previous race), so we can
   * render a small visual gap between groups.
   */
  isFirstInNewGroup(distance: ProcessedDistance, raceIdx: number): boolean {
    const races = distance.processedRaces;
    if (!races || raceIdx <= 0 || raceIdx >= races.length) return false;
    return races[raceIdx].laps_count !== races[raceIdx - 1].laps_count;
  }

  /**
   * Returns the StandingsGroup that contains the given race id, or null.
   * Used to render a group divider above the first member of each group.
   */
  groupForRace(distance: ProcessedDistance, raceId: string): StandingsGroup | null {
    if (!distance.standingsGroups) return null;
    return distance.standingsGroups.find(g => g.races[0]?.id === raceId) ?? null;
  }

  /** Returns the display name for a standings group. */
  groupDisplayName(group: StandingsGroup, isFirst: boolean, anyFinished = false): string {
    if (group.isOthers) return 'Tail of the race';
    if (isFirst && !anyFinished) return 'Head of the race';
    return 'Group ' + group.groupNumber;
  }

  formatDebugTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  /**
   * Returns true when the competitor is the leader of the head group
   * (group_number === 1, gap_to_above === null) and no one has finished yet.
   */
  isRaceLeader(race: CompetitorUpdate, distance: ProcessedDistance): boolean {
    if (distance.anyFinished) return false;
    return race.group_number === 1 && race.gap_to_above == null && race.finished_rank == null && !!race.total_time;
  }


  /**
   * Returns d-none classes so card at groupIndex is hidden when viewport is too narrow.
   * xs shows 1, sm shows 2, md shows 3, lg shows 4, xl shows 5+
   */
  groupCardClass(groupIndex: number): string {
    if (groupIndex === 0) return '';
    if (groupIndex === 1) return 'd-none d-sm-block';
    if (groupIndex === 2) return 'd-none d-md-block';
    if (groupIndex === 3) return 'd-none d-lg-block';
    return 'd-none d-xl-block';
  }
}
