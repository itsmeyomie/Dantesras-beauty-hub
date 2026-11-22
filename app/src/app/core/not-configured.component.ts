import { Component, inject } from '@angular/core';
import { DataService } from './data.service';

@Component({
  selector: 'app-not-configured',
  template: `
    @if (!data.configured) {
      <div class="notice">
        <strong>Supabase is not connected yet.</strong>
        Add your project URL and anon key in <code>src/environments/environment.ts</code>,
        then run the SQL files in <code>supabase/migrations</code> (see README).
      </div>
    }
  `,
})
export class NotConfiguredComponent {
  readonly data = inject(DataService);
}
