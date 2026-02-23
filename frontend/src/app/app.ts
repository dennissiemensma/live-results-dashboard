import { Component, OnDestroy, OnInit } from '@angular/core';
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
  backendStatus: string = 'Connecting...';
  dataSourceUrl: string = '';
  dataSourceInterval: number | null = null;

  private socket$: WebSocketSubject<any> | null = null;
  // Use localhost for both dev and prod in this local setup context
  private readonly BACKEND_URL = 'ws://localhost:5000/ws';

  ngOnInit() {
    this.connect();
  }

  connect() {
    this.socket$ = webSocket(this.BACKEND_URL);

    this.socket$.subscribe({
      next: (msg: any) => {
        if (msg.type === 'status') {
          this.backendStatus = 'Connected';
          this.dataSourceUrl = msg.data.data_source_url;
          this.dataSourceInterval = msg.data.data_source_interval;
        } else if (msg.type === 'data') {
          this.data = msg.data;
        }
      },
      error: (err) => {
        console.error('WebSocket error:', err);
        this.backendStatus = 'Disconnected';
      },
      complete: () => {
        this.backendStatus = 'Disconnected';
      },
    });
  }

  ngOnDestroy() {
    if (this.socket$) {
      this.socket$.complete();
    }
  }
}
