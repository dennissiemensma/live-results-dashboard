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
import { FormsModule } from '@angular/forms';

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
    FormsModule,
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

  // Management popup state
  managementPopupVisible = false;
  managementPassword = '';
  managementError: string | null = null;
  backendUrl = '';
  managementBackendDataSourceUrl = '';
  managementInterval = 1;
  managementPolling = true;

  // Hide mass start settings if no mass start present
  hasMassStart$: Observable<boolean>;

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

  onLapVarianceChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(val)) this.dataService.setLapVarianceThreshold(val);
  }

  onShowLapTimesChange(event: Event): void {
    this.dataService.setShowMassStartLapTimes((event.target as HTMLInputElement).checked);
  }

  /**
   * Returns a CSS class name for a lap time badge based on variance vs the previous lap.
   * First lap: always 'lap-badge-normal' (green).
   * Subsequent laps: compare to previous lap using the lapVarianceThreshold (%).
   *   > threshold% slower  → 'lap-badge-slow'   (orange)
   *   > threshold% faster  → 'lap-badge-fast'   (purple)
   *   within threshold     → 'lap-badge-normal' (green)
   */
  lapBadgeColor(lapTimes: string[], i: number): string {
    if (i === 0 || !lapTimes[i - 1]) return 'lap-badge-normal';
    const curr = this._parseSeconds(lapTimes[i]);
    const prev = this._parseSeconds(lapTimes[i - 1]);
    if (!prev) return 'lap-badge-normal';
    const threshold = this.dataService.lapVarianceThreshold / 100;
    const ratio = (curr - prev) / prev;
    if (ratio > threshold)  return 'lap-badge-slow';   // current slower  → orange
    if (ratio < -threshold) return 'lap-badge-fast';   // current faster  → purple
    return 'lap-badge-normal';
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
    this.hasMassStart$ = this.dataService.processedData$.pipe(
      map(distances => !!distances?.some(d => d.isMassStart))
    );
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
    // Prefill backend URL from localStorage or default
    const storedUrl = localStorage.getItem('backendUrl');
    this.backendUrl = storedUrl || 'http://backend:5000/ws';
    // Prefill backend data source from backend status if available
    this.status$.subscribe(status => {
      if (status?.url) {
        this.managementBackendDataSourceUrl = status.url;
      }
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
    if (!t) return ['', ''];
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
   * Returns the ordered list of cumulative distances (in metres) at which
   * a lap is expected for a timed distance, derived from first_lap % 400.
   * e.g. distanceMeters=1000 → [200, 600, 1000]
   *      distanceMeters=500  → [100, 500]
   *      distanceMeters=100  → [100]
   */
  timedDistanceLapSchedule(distanceMeters: number): number[] {
    const firstLap = distanceMeters % 400 || 400;
    const laps: number[] = [firstLap];
    let cumulative = firstLap;
    while (cumulative < distanceMeters) {
      cumulative += 400;
      laps.push(cumulative);
    }
    return laps;
  }

  /** Total number of expected laps for a timed distance. */
  timedDistanceTotalLaps(distanceMeters: number): number {
    return this.timedDistanceLapSchedule(distanceMeters).length;
  }

  /** True when the competitor has completed all laps for the timed distance. */
  isTimedFinished(race: CompetitorUpdate, distanceMeters: number): boolean {
    return race.laps_count >= this.timedDistanceTotalLaps(distanceMeters);
  }

  /**
   * Returns the lapTime string for the nth lap (0-based) of a timed competitor,
   * or null if that lap has not been completed yet.
   */
  timedLapTime(race: CompetitorUpdate, lapIndex: number): string | null {
    return race.lap_times?.[lapIndex] ?? null;
  }

  /**
   * Returns the cumulative total time up to and including lap `lapIndex` as a
   * formatted string (e.g. "1:23.456"), summing individual split lap_times.
   * Returns null if the lap has not been completed yet.
   */
  timedCumulativeTime(race: CompetitorUpdate, lapIndex: number): string | null {
    if (!race.lap_times || race.lap_times.length <= lapIndex) return null;
    let total = 0;
    for (let i = 0; i <= lapIndex; i++) {
      total += this._parseSeconds(race.lap_times[i]);
    }
    // format as [H:]MM:SS.mmm or SS.mmm
    const totalMs = Math.floor(total * 1000);
    const ms = totalMs % 1000;
    const secs = Math.floor(totalMs / 1000) % 60;
    const mins = Math.floor(totalMs / 60000) % 60;
    const hrs = Math.floor(totalMs / 3600000);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const msPart = String(ms).padStart(3, '0');
    if (hrs > 0) return `${hrs}:${pad2(mins)}:${pad2(secs)}.${msPart}`;
    if (mins > 0) return `${mins}:${pad2(secs)}.${msPart}`;
    return `${secs}.${msPart}`;
  }

  /**
   * Returns a formatted time improvement string like "- 0.521 s" when the
   * competitor has a personal best, or null otherwise.
   */
  pbImprovement(race: CompetitorUpdate): string | null {
    if (!race.is_personal_record || !race.total_time || !race.personal_record) return null;
    const diff = this._parseSeconds(race.personal_record) - this._parseSeconds(race.total_time);
    if (diff <= 0) return null;
    return `- ${diff.toFixed(3)} s`;
  }

  private _parseSeconds(t: string): number {
    const parts = t.split(':');
    if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]);
  }

  /**
   * Truncates (not rounds) a formatted lap time string to `decimals` decimal places.
   * e.g. truncateLapTime("23.456", 1) → "23.4"
   *      truncateLapTime("1:23.456", 1) → "1:23.4"
   */
  truncateLapTime(t: string, decimals = 1): string {
    if (!t) return t;
    const dot = t.lastIndexOf('.');
    if (dot === -1) return t;
    return t.substring(0, dot + 1 + decimals);
  }

  /**
   * Like truncateLapTime but returns [integerPart, decimalPart] for split rendering.
   * e.g. "1:23.456" → ["1:23", ".4"]
   */
  splitLapTime(t: string): [string, string] {
    const truncated = this.truncateLapTime(t, 1);
    const dot = truncated.lastIndexOf('.');
    if (dot === -1) return [truncated, ''];
    return [truncated.substring(0, dot), truncated.substring(dot)];
  }

  /**
   * Returns the number of pending (not-yet-completed) laps for a mass-start competitor.
   * = totalLaps - lap_times.length, clamped to 0.
   */
  pendingLapCount(race: CompetitorUpdate, totalLaps: number): number {
    return Math.max(0, totalLaps - (race.lap_times?.length ?? 0));
  }

  /**
   * Returns d-none classes so card at groupIndex is hidden when viewport is too narrow.
   * xs shows 1, sm shows 2, md shows 3, lg shows 4, xl shows 5+
   */
  groupCardClass(groupIndex: number): string {
    if (groupIndex < 0) return '';
    const size = Math.max(1, Math.min(5, this.getViewportSize()));
    const base = 'd-none d-sm-block';
    const show = `d-lg-none`;
    const hide = `d-sm-none`;
    return groupIndex < size ? show : hide;
  }

  /**
   * Returns true when the competitor's race is currently live (in progress).
   * - For mass start: isLive is true.
   * - For timed distance: total_time is set and not yet marked as finished.
   */
  isRaceLive(race: CompetitorUpdate, distance: ProcessedDistance): boolean {
    if (distance.isMassStart) return distance.isLive;
    return !!race.total_time && distance.distanceMeters != null && !this.isTimedFinished(race, distance.distanceMeters);
  }

  /**
   * Returns the CSS class for the status badge, based on the competitor's status.
   * - green  → finished within target time
   * - orange → finished but outside target time
   * - red    → not finished, but time is up
   * - grey   → not started or no result yet
   */
  statusBadgeClass(race: CompetitorUpdate, distance: ProcessedDistance): string {
    if (distance.isMassStart) return distance.isLive ? 'bg-success' : 'bg-secondary';
    if (distance.distanceMeters != null && this.isTimedFinished(race, distance.distanceMeters)) {
      return 'bg-success';
    }
    return 'bg-secondary';
  }

  /**
   * Returns the text for the status badge, indicating time or gap.
   * - For finished competitors: elapsed time (e.g. "1:23.456").
   * - For non-finished competitors: gap to leader (e.g. "+12.3").
   * - For mass start: shows "LIVE" when isLive, else elapsed time.
   */
  statusBadgeText(race: CompetitorUpdate, distance: ProcessedDistance): string {
    if (distance.isMassStart) return distance.isLive ? 'LIVE' : (distance.distanceMeters != null ? this.timedCumulativeTime(race, race.laps_count - 1) ?? '' : '');
    if (distance.distanceMeters != null && this.isTimedFinished(race, distance.distanceMeters)) return this._formatElapsedTime(race.total_time);
    const leaderGap = race.gap_to_above;
    if (leaderGap == null) return '';
    const gapSeconds = this._parseSeconds(leaderGap);
    if (gapSeconds < 0) return '';
    return '+' + this._formatElapsedTime(leaderGap);
  }

  private _formatElapsedTime(timeString: string): string {
    const totalSeconds = this._parseSeconds(timeString);
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const ms = Math.floor((totalSeconds % 1) * 1000);
    return `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  /**
   * Returns the current viewport size as a number:
   * - xs: 0, sm: 1, md: 2, lg: 3, xl: 4.
   */
  private getViewportSize(): number {
    const width = window.innerWidth;
    if (width < 576) return 0;  // xs
    if (width < 768) return 1;  // sm
    if (width < 992) return 2;  // md
    if (width < 1200) return 3; // lg
    return 4;                    // xl
  }

  onStatusBadgeClick(): void {
    // When opening popup, prefill backend URL from localStorage or default
    const storedUrl = localStorage.getItem('backendUrl');
    this.backendUrl = storedUrl || 'http://backend:5000/ws';
    // Fetch settings from backend
    this.dataService.fetchSettings().subscribe({
      next: (settings: any) => {
        this.managementBackendDataSourceUrl = settings.data_source_url;
        this.managementInterval = settings.data_source_interval;
        this.managementPolling = settings.polling;
      },
      error: () => {
        this.managementError = 'Failed to fetch settings from backend.';
      }
    });
    this.managementPopupVisible = !this.managementPopupVisible;
  }

  /**
   * Saves the current backend URL to localStorage and updates the data service.
   * Called by the management popup's Save button.
   */
  saveFrontendConfig(): void {
    localStorage.setItem('backendUrl', this.backendUrl);
    this.dataService.setBackendUrl();
  }


  fetchManagementStatus(): void {
    this.managementError = null;
    this.dataService.status$.subscribe();
  }

  setPolling(action: 'start' | 'stop'): void {
    this.managementError = null;
    this.dataService.managePost('polling', this.managementPassword, { action }).subscribe({
      next: (res: any) => { this.managementPolling = res.polling; },
      error: () => { this.managementError = 'Failed to update polling state.'; }
    });
  }

  saveManagementSettings(): void {
    this.managementError = null;
    this.dataService.managePost('source_url', this.managementPassword, { data_source_url: this.managementBackendDataSourceUrl }).subscribe({
      error: () => { this.managementError = 'Failed to update source URL.'; }
    });
    this.dataService.managePost('interval', this.managementPassword, { data_source_interval: this.managementInterval }).subscribe({
      error: () => { this.managementError = 'Failed to update interval.'; }
    });
  }

  resetManagementData(): void {
    this.managementError = null;
    this.dataService.managePost('reset', this.managementPassword, {}).subscribe({
      error: () => { this.managementError = 'Failed to reset data.'; }
    });
  }

  closeManagementPopup(): void {
    this.managementPopupVisible = false;
  }
}
