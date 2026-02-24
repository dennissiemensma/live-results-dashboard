import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { ProcessedDistance } from '../../models/data.models';
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
})
export class DashboardComponent implements OnInit, OnDestroy {
  sortedDistances$: Observable<ProcessedDistance[]>;
  eventName$: Observable<string>;
  errors$: Observable<string[]>;
  status$: Observable<import('../../services/data.service').BackendStatus>;
  secondsSinceUpdate$: Observable<number>;

  initialLiveId: string | null = null;
  pulseActive = false;

  private pulseTimeout: ReturnType<typeof setTimeout> | null = null;
  private dataSub: Subscription | null = null;

  constructor(public dataService: DataService) {
    this.status$ = this.dataService.status$;
    this.eventName$ = this.dataService.eventName$;
    this.errors$ = this.dataService.errors$;

    this.sortedDistances$ = this.dataService.processedData$.pipe(
      map((distances) => {
        if (!distances || distances.length === 0) return [];
        const sorted = [...distances].sort((a, b) => b.eventNumber - a.eventNumber);
        // Capture the first live distance id only once
        if (this.initialLiveId === null) {
          const live = sorted.find((d) => d.isLive);
          if (live) this.initialLiveId = live.id;
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
    this.dataSub = this.dataService.lastDataReceived$.subscribe((ts) => {
      if (!ts) return;
      this.pulseActive = true;
      if (this.pulseTimeout) clearTimeout(this.pulseTimeout);
      this.pulseTimeout = setTimeout(() => (this.pulseActive = false), 2000);
    });
  }

  ngOnDestroy() {
    this.dataSub?.unsubscribe();
    if (this.pulseTimeout) clearTimeout(this.pulseTimeout);
  }

  isRecentUpdate(timestamp: number | undefined): boolean {
    if (!timestamp) return false;
    return Date.now() - timestamp < 3000;
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

  /**
   * Returns a Bootstrap display class to hide a group card in the top strip
   * when it exceeds the visible count for the current breakpoint.
   * Groups are rendered right-to-left (index 0 = head of race = rightmost).
   * We show: xs:1, sm:2, md:3, lg:4, xl:5
   */
  groupStripVisibility(groupIndex: number): string {
    // Build a class string that hides this card at breakpoints where it would overflow.
    // groupIndex 0 is always visible. groupIndex N is hidden below the breakpoint that fits N+1 cards.
    const breakpoints = [
      { minCards: 2, hideBelow: 'sm' },
      { minCards: 3, hideBelow: 'md' },
      { minCards: 4, hideBelow: 'lg' },
      { minCards: 5, hideBelow: 'xl' },
    ];
    for (const bp of breakpoints) {
      if (groupIndex >= bp.minCards) {
        // This card is beyond what fits at this breakpoint and below
        return `d-none d-${bp.hideBelow}-flex`;
      }
    }
    return 'd-flex'; // always visible (index 0–1 at xs+, 0–2 at sm+, etc. — handled cumulatively below)
  }

  /**
   * Returns d-none classes so card at groupIndex is hidden when viewport is too narrow.
   * xs shows 1, sm shows 2, md shows 3, lg shows 4, xl shows 5+
   */
  groupCardClass(groupIndex: number): string {
    if (groupIndex === 0) return ''; // always visible
    if (groupIndex === 1) return 'd-none d-sm-block';
    if (groupIndex === 2) return 'd-none d-md-block';
    if (groupIndex === 3) return 'd-none d-lg-block';
    return 'd-none d-xl-block'; // groupIndex >= 4
  }
}
