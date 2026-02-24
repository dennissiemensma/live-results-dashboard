import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { LiveComponent } from './components/live/live.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'live', component: LiveComponent },
  { path: '**', redirectTo: '' }
];
