import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { Account, Relationship } from '../../models';
import { Profile } from './profile';

/**
 * Profile block/unblock wiring, isolated at the HTTP boundary — no live or mock server.
 * We drive the component's toggleBlock() and assert it hits the right endpoint based on the
 * current relationship, then reflects the server's updated relationship.
 */
describe('Profile block/unblock', () => {
  let httpMock: HttpTestingController;

  function setUp() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: '900' })) },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();

    // load() fans out three requests; satisfy them so the component settles.
    httpMock.expectOne('/api/v1/accounts/900').flush({ id: '900', username: 'eve' } as Account);
    httpMock.expectOne('/api/v1/accounts/900/statuses').flush([]);
    httpMock
      .expectOne((r) => r.url === '/api/v1/accounts/relationships')
      .flush([{ id: '900', blocking: false } as Relationship]);

    return fixture;
  }

  afterEach(() => httpMock.verify());

  it('blocks an un-blocked account via POST /block and stores the updated relationship', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;
    expect(cmp.relationship().blocking).toBe(false);

    cmp.toggleBlock();

    const req = httpMock.expectOne('/api/v1/accounts/900/block');
    expect(req.request.method).toBe('POST');
    req.flush({ id: '900', blocking: true } as Relationship);

    expect(cmp.relationship().blocking).toBe(true);
  });

  it('unblocks a blocked account via POST /unblock', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;
    // Pretend the account is already blocked.
    cmp.relationship.set({ id: '900', blocking: true } as Relationship);

    cmp.toggleBlock();

    const req = httpMock.expectOne('/api/v1/accounts/900/unblock');
    expect(req.request.method).toBe('POST');
    req.flush({ id: '900', blocking: false } as Relationship);

    expect(cmp.relationship().blocking).toBe(false);
  });
});
