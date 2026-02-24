import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { ProcessedDistance } from '../../models/data.models';import { Observable, combineLatest, timer, map, take, Subscription } from 'rxjs';
import {
  AccordionModule,
  AlertModule,
  BadgeModule,
  ButtonModule,
  CardModule,
  GridModule,
  SharedModule,
} from '@coreui/angular';
import { Router } from '@angular/router';

@Component({
  selector: 'app-live',
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
  templateUrl: './live.component.html',
  styleUrls: ['./live.component.scss'],
})
export class LiveComponent implements OnInit, OnDestroy {
  sortedDistances$: Observable<ProcessedDistance[]>;
  eventName$: Observable<string>;
  errors$: Observable<string[]>;
  secondsSinceUpdate$: Observable<number>;

  initialLiveId: string | null = null;
  pulseActive = false;

  private pulseTimeout: ReturnType<typeof setTimeout> | null = null;
  private dataSubscription: Subscription | null = null;

  constructor(
    public dataService: DataService,
    private router: Router,
  ) {
    this.sortedDistances$ = this.dataService.processedData$.pipe(
      map((distances) => {
        if (!distances) return [];
        const sorted = [...distances].sort((a, b) => b.eventNumber - a.eventNumber);

        // Set initial live ID only once
        if (this.initialLiveId === null) {
          const liveDistance = sorted.find((d) => d.isLive);
          if (liveDistance) {
            this.initialLiveId = liveDistance.id;
          }
        }
        return sorted;
      }),
    );

    this.eventName$ = this.dataService.eventName$;
    this.errors$ = this.dataService.errors$;

    // Seconds since last update (ticks every second)
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
    // Check connection status on initialization. If not connected, redirect to dashboard.
    this.dataService.status$.pipe(take(1)).subscribe((status) => {
      if (status.status === 'Disconnected') {
        this.router.navigate(['/']);
      }
    });

    // Pulse animation on new data
    this.dataSubscription = this.dataService.lastDataReceived$.subscribe((ts) => {
      if (!ts) return;
      this.pulseActive = true;
      if (this.pulseTimeout) clearTimeout(this.pulseTimeout);
      this.pulseTimeout = setTimeout(() => {
        this.pulseActive = false;
      }, 2000);
    });
  }

  ngOnDestroy() {
    this.dataSubscription?.unsubscribe();
    if (this.pulseTimeout) clearTimeout(this.pulseTimeout);
  }


  isRecentUpdate(timestamp: number | undefined): boolean {
    if (!timestamp) return false;
    return Date.now() - timestamp < 3000;
  }


  /** Pad startNumber to at least 2 chars */
  padStartNumber(n: string): string {
    return n.padStart(2, ' ');
  }

  /** Returns text color class for badge based on lane color */
  badgeTextClass(lane: string): string {
    const light = ['white', 'yellow', 'orange', 'pink', 'lime'];
    return light.includes((lane || '').toLowerCase()) ? 'text-dark' : 'text-white';
  }

  /** Format the time with styled decimals — returns parts [integer, decimal] */
  splitFormattedTime(formattedTime: string): [string, string] {
    if (!formattedTime || formattedTime === 'No Time') return [formattedTime || '', ''];
    const dotIdx = formattedTime.indexOf('.');
    if (dotIdx === -1) return [formattedTime, ''];
    return [formattedTime.substring(0, dotIdx), '.' + formattedTime.substring(dotIdx + 1)];
  }
}
