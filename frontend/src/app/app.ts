import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App implements OnInit, OnDestroy {
  data: any;
  backendStatus: string = 'Disconnected';
  dataSourceUrl: string = '';
  dataSourceInterval: number | null = null;

  private socket$: WebSocketSubject<any> | null = null;
  // Use localhost for both dev and prod in this local setup context
  private readonly BACKEND_URL = 'ws://localhost:5000/ws';

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    // Connection is now manual via button click, not on initialization
  }

  public connect() {
    if (this.socket$ && !this.socket$.closed) {
        return;
    }
    this.backendStatus = 'Connecting...';
    // Use window.location.hostname to validly connect to the backend relative to the browser
    this.socket$ = webSocket(`ws://${window.location.hostname}:5000/ws`);

    this.socket$.subscribe({
      next: (msg: any) => {
        console.log('Received message:', msg); // Debug log
        if (msg.type === 'status') {
          this.backendStatus = 'Connected';
          this.dataSourceUrl = msg.data.data_source_url;
          this.dataSourceInterval = msg.data.data_source_interval;
        } else if (msg.type === 'data') {
          this.data = msg.data;
          this.cdr.detectChanges(); // Manually trigger change detection
        }
      },
      error: (err) => {
        console.error('WebSocket error:', err);
        this.backendStatus = 'Disconnected';
        this.socket$ = null;
      },
      complete: () => {
        this.backendStatus = 'Disconnected';
        this.socket$ = null;
      },
    });
  }

  public disconnect() {
      if (this.socket$) {
          this.socket$.complete();
          this.socket$ = null;
          this.backendStatus = 'Disconnected';
          this.data = null;
      }
  }

  ngOnDestroy() {
    this.disconnect();
  }
}
