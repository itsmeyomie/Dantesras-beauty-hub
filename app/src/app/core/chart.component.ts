import { Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, Tooltip, DoughnutController, ArcElement, Legend } from 'chart.js';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, DoughnutController, ArcElement, Legend);

const MAROON = '#7b1e2e';
const GOLD = '#c9a227';
const PALETTE = [MAROON, GOLD, '#141414', '#a85567', '#8a7a3c', '#6b6259', '#b69bd0'];

/** Small brand-coloured chart. type: bar | hbar | line | doughnut */
@Component({
  selector: 'app-chart',
  template: `<div class="wrap" [style.height.px]="height()"><canvas #c [attr.aria-label]="ariaLabel()" role="img"></canvas></div>`,
  styles: `.wrap { position: relative; width: 100%; }`,
})
export class ChartComponent implements OnDestroy {
  readonly type = input<'bar' | 'hbar' | 'line' | 'doughnut'>('bar');
  readonly labels = input<string[]>([]);
  readonly values = input<number[]>([]);
  readonly height = input(220);
  readonly ariaLabel = input('Chart');
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private chart?: Chart;

  constructor() {
    effect(() => {
      const labels = this.labels();
      const values = this.values();
      const t = this.type();
      this.chart?.destroy();
      const isDoughnut = t === 'doughnut';
      this.chart = new Chart(this.canvas().nativeElement, {
        type: t === 'hbar' ? 'bar' : t,
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: isDoughnut ? PALETTE : t === 'line' ? 'rgba(123,30,46,.12)' : MAROON,
            borderColor: isDoughnut ? '#fff' : MAROON,
            borderWidth: isDoughnut ? 2 : t === 'line' ? 2 : 0,
            borderRadius: t === 'bar' || t === 'hbar' ? 4 : 0,
            pointBackgroundColor: GOLD,
            fill: t === 'line',
            tension: 0.3,
          }],
        },
        options: {
          indexAxis: t === 'hbar' ? 'y' : 'x',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: isDoughnut, position: 'right' },
            tooltip: { callbacks: { label: (c) => ' KSh ' + Number(c.raw).toLocaleString('en-KE') } },
          },
          scales: isDoughnut ? {} : {
            x: { grid: { display: t === 'hbar' }, ticks: { color: '#6b6259' } },
            y: { grid: { display: t !== 'hbar' }, ticks: { color: '#6b6259' }, beginAtZero: true },
          },
        },
      });
    });
  }
  ngOnDestroy() {
    this.chart?.destroy();
  }
}
