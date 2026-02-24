import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import {
  CardModule,
  GridModule,
  ButtonModule,
  BadgeModule,
  AlertModule,
} from '@coreui/angular';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CardModule, GridModule, ButtonModule, BadgeModule, AlertModule],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  constructor(public dataService: DataService) {}
}
