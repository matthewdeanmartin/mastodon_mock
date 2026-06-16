import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AdminAccount, AdminReport, DomainBlock } from '../models';

/** Wrapper over the /api/v1/admin/* moderation surface. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private http = inject(HttpClient);

  // --- accounts ---
  accounts(status = 'active'): Observable<AdminAccount[]> {
    const params = new HttpParams().set('origin', 'local').set('status', status);
    return this.http.get<AdminAccount[]>('/api/v2/admin/accounts', { params });
  }

  /** Apply a moderation action: disable | silence | suspend | sensitive. */
  moderate(id: string, type: string): Observable<AdminAccount> {
    return this.http.post<AdminAccount>(`/api/v1/admin/accounts/${id}/action`, { type });
  }

  enable(id: string): Observable<AdminAccount> {
    return this.http.post<AdminAccount>(`/api/v1/admin/accounts/${id}/enable`, {});
  }

  unsilence(id: string): Observable<AdminAccount> {
    return this.http.post<AdminAccount>(`/api/v1/admin/accounts/${id}/unsilence`, {});
  }

  unsuspend(id: string): Observable<AdminAccount> {
    return this.http.post<AdminAccount>(`/api/v1/admin/accounts/${id}/unsuspend`, {});
  }

  approve(id: string): Observable<AdminAccount> {
    return this.http.post<AdminAccount>(`/api/v1/admin/accounts/${id}/approve`, {});
  }

  // --- reports ---
  reports(resolved: boolean): Observable<AdminReport[]> {
    let params = new HttpParams();
    if (resolved) {
      params = params.set('resolved', 'true');
    }
    return this.http.get<AdminReport[]>('/api/v1/admin/reports', { params });
  }

  assignReport(id: string): Observable<AdminReport> {
    return this.http.post<AdminReport>(`/api/v1/admin/reports/${id}/assign_to_self`, {});
  }

  resolveReport(id: string): Observable<AdminReport> {
    return this.http.post<AdminReport>(`/api/v1/admin/reports/${id}/resolve`, {});
  }

  reopenReport(id: string): Observable<AdminReport> {
    return this.http.post<AdminReport>(`/api/v1/admin/reports/${id}/reopen`, {});
  }

  // --- domain blocks ---
  domainBlocks(): Observable<DomainBlock[]> {
    return this.http.get<DomainBlock[]>('/api/v1/admin/domain_blocks');
  }

  createDomainBlock(domain: string, severity: string): Observable<DomainBlock> {
    return this.http.post<DomainBlock>('/api/v1/admin/domain_blocks', { domain, severity });
  }

  deleteDomainBlock(id: string): Observable<unknown> {
    return this.http.delete(`/api/v1/admin/domain_blocks/${id}`);
  }
}
