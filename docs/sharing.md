# Sharing (MVP): Unified Course Sharing (Read‑Only)

This document describes the initial (MVP) implementation of **read‑only sharing** for Courses (and structure prepared for Plans). It is distinct from the existing `public` (discoverable) visibility flag.

---

## 1. Concepts & Terminology

| Term | Meaning |
| ---- | ------- |
| `public` (discoverable) | Course is visible to authenticated users in internal listings / search and can be cloned/starred. Requires login. |
| `shareEnabled` (shared link) | A direct URL anyone (including logged‑out guests) can open for a read-only view. Not searchable, not indexed, not cloneable (for guests). |

Key Differences:
- A course can be `shareEnabled = true` while still `public = false` (private except to those with link).
- Disabling sharing immediately makes the link return `404`.
- Re‑enabling reuses the same UUID-based URL (no regeneration in MVP).

---

## 2. Current Scope (MVP)

Included:
- Boolean flags: `courses.shareEnabled`, `plans.shareEnabled` (the plans flag is present for forward compatibility; only Course sharing UI/pages implemented now).
- Public anonymous endpoint: `GET /api/public/courses/:id`.
- Public access now uses the canonical route `/courses/:id` (read-only when unauthenticated and `shareEnabled=true`).
- Sanitized payload (no raw original file content or owner identifiers).
- Minimal read‑only UI with waypoints list and basic metadata.
- `noindex,nofollow` meta to discourage search engine indexing.

Excluded (Future Enhancements):
- Tokenized (rotatable) share links.
- Per-link analytics / view counts.
- Per-link expiration / password / gating (email capture).
- Embedded or iframe mode.
- Multiple simultaneous links per entity.
- Public plan page (structure prepared; not yet built).

---

## 3. Data Model

New columns (SQLite / Drizzle):

```
courses.share_enabled     BOOLEAN NOT NULL DEFAULT 0
plans.share_enabled       BOOLEAN NOT NULL DEFAULT 0
```

Drizzle schema additions (simplified excerpt):
- `shareEnabled: integer("share_enabled", { mode: "boolean" }).notNull().default(false)`

Migration generated: `drizzle/0003_*.sql`

---

## 4. Endpoints

### 4.1 Public Anonymous
`GET /api/public/courses/:id`

Returns:
```
{
  "course": {
    "id": "...",
    "name": "...",
    "description": "...",
    "geoJsonData": {...},
    "totalDistance": <number|null>,
    "elevationGain": <number|null>,
    "elevationLoss": <number|null>,
    "raceDate": <timestamp|null>,
    "shareEnabled": true,
    "public": false,
    "createdAt": "<timestamp>",
    "updatedAt": "<timestamp>",
    "waypoints": [
      {
        "id": "...",
        "name": "...",
        "description": "...",
        "lat": "...",
        "lng": "...",
        "elevation": <number|null>,
        "distance": <number>,
        "order": <number>,
        "icon": "<string|null>"
      },
      ...
    ],
    "_omitted": [
      "originalFileContent",
      "originalFileName",
      "userId",
      "forkedFromCourseId"
    ]
  }
}
```

404 Conditions:
- Course not found.
- `shareEnabled` is false.

### 4.2 Authenticated Update
`PUT /api/courses/:id`
Body can now include:
```
{
  "shareEnabled": boolean,
  "public": boolean,
  "name": "...",
  "description": "...",
  "raceDate": "YYYY-MM-DDTHH:MM:SS" | null
}
```
Ownership required for `shareEnabled` and `public` changes.

---

## 5. Frontend Pages

### 5.1 Share Page
Public read-only view is served from the same path: `/courses/:id` (no separate `/share` route).

Characteristics:
- No authenticated layout / global nav.
- Fetches from the public endpoint.
- Shows:
  - Title, description
  - Distance / elevation stats
  - Race date (if any)
  - Ordered waypoint list
- Footer disclaimer: read‑only.

### 5.2 Owner UI (Enable / Disable)
Add a control (e.g., in course detail settings panel):

States:
1. Disabled:
   - Button: “Enable shareable link”
2. Enabled:
   - Shows copyable URL: `.../courses/<courseId>` (guests see read-only view if shareEnabled)
   - Button(s): “Disable sharing”
   - (No regeneration in MVP—document this clearly.)

Recommended UX Copy:
> This link lets anyone view a read-only version of your course. It will not appear in search or discovery unless you also mark it public.

---

## 6. Security & Privacy Notes

- Using the v4 UUID as the “secret” path segment (sufficient entropy; brute forcing impractical).
- Disabling sharing invalidates the link (returns 404).
- Re-enabling reuses the same URL (limitation accepted for MVP).
- Raw GPX/TCX (`originalFileContent`) and file name are intentionally excluded.
- No ownership or internal user IDs are exposed.
- `public` discoverability remains an independent choice; a course can be shareable *and still hidden* from in-app discovery.

Threat Considerations:
- If the course ID appears in other authenticated contexts and a user copies it, they can form the share URL (acceptable risk for MVP).
- If eventual “link rotation” is needed, we will migrate to a token table (see Future Roadmap).

---

## 7. Future Roadmap (Planned Enhancements)

| Feature | Rationale |
| ------- | --------- |
| Token table (`share_links`) | Rotatable & multiple concurrent links. |
| View counts & last viewed | Basic creator analytics. |
| Expiry dates | Time-bound access for events / paid previews. |
| Password / access code | Lightweight gating without full account creation. |
| Email capture / CTA overlay | Growth funnel / marketing integration. |
| Embeddable widget | Allow embedding in blogs or event pages (iframe-safe). |
| Public plan sharing page | Mirror course share for pacing strategies. |
| Restricted waypoint fields | Optionally hide certain waypoint meta. |
| API rate limiting | Defensive measure for scraping patterns. |

---

## 8. Testing Checklist

Manual:
- Enable sharing -> open link in incognito -> Course loads.
- Disable sharing -> same link now 404.
- Re-enable -> link works again.
- Confirm no editing controls appear.
- Confirm network panel only calls `/api/public/courses/:id`.
- Meta tag `noindex,nofollow` present in page head.
- Fields excluded: verify absence of `originalFileContent` in payload.

Automated (suggested additions):
- Endpoint 404 when share disabled.
- Endpoint 200 when enabled.
- Payload schema validation (snapshot or runtime zod schema for safety).
- Ensure `PUT /api/courses/:id` rejects shareEnabled changes by non-owner.

---

## 9. Known Limitations (MVP Deliberate Tradeoffs)

| Limitation | Impact | Mitigation Path |
| ---------- | ------ | --------------- |
| No link rotation | Cannot invalidate old viewers selectively | Introduce token table & regeneration UI later |
| Same ID reused after re-enable | Prior recipients regain access | Tokenization future |
| No analytics | Creators lack insight into link usage | Add view counter & event log |
| No selective waypoint hiding | All waypoints visible | Add per-waypoint visibility flag later |
| Single layout variant | Limited branding for public pages | Introduce themed layouts / embed mode |

---

## 10. Developer Notes

Implementation Files (Key):
- `server/api/public/courses/[id].get.ts`: Public projection logic.
- `server/api/courses/[id].put.ts`: Accepts `shareEnabled`.
- (Removed) `app/pages/share/courses/[id].vue` — unified into `app/pages/courses/[id].vue`.
- `app/utils/db/schema.ts`: Added `shareEnabled` columns.

Projection Principles:
- Outbound shape clearly indicates omitted sensitive fields via `_omitted` array (client may ignore; helpful debug signal).
- Keep projection logic consolidated for easy enhancement (if it grows, refactor into a dedicated utility module, e.g. `server/utils/publicProjection.ts`).

---

## 11. FAQ

Q: Why not just let anonymous users hit the existing authenticated endpoint?
A: Mixing guest logic into secured endpoints risks data leakage and conditional complexity. Separate endpoint enforces a narrower, safer response contract.

Q: Why no token now?
A: Simplicity and speed. UUID already sufficiently unguessable; rotation not currently required.

Q: Can guests clone or copy?
A: No. Cloning requires authenticated flows (course membership creation logic).

Q: Does enabling sharing make it discoverable?
A: No. Discovery is still governed by the `public` flag.

Q: How do we later migrate to tokens?
A: Add `share_links` table with (id, entityType, entityId, tokenHash, enabled, createdAt, revokedAt). Deprecate direct UUID route or keep it as “legacy share” until sunset.

---

## 12. Quick How-To (Owner Workflow)

1. Open a course you own.
2. Toggle “Enable shareable link”.
3. Copy the displayed URL.
4. Send to recipient(s).
5. To revoke: toggle off (instant 404).
6. (Re-enable if needed—same link works again.)

---

## 13. Future Migration Outline (Tokenization Draft)

When needed:
1. Create table:
   ```
   share_links(id, entity_type, entity_id, token_hash, enabled, created_at, revoked_at)
   ```
2. Backfill existing courses with `shareEnabled = true` into a token row.
3. Introduce new URL scheme: `/share/c/:token`.
4. (Complete) Removed legacy `/share/courses/:id` route; unified handling under `/courses/:id`.
5. Add UI “Regenerate Link” (revokes old, creates new, updates copyable link).

---

## 14. Support / Maintenance Notes

- If users report “shared link stopped working”: verify `shareEnabled` still true.
- If accidentally exposed sensitive fields in future edits—immediately audit the selection list in the public endpoint.
- Watch for performance: heavy `geoJsonData` may warrant slimming or pre-computing summary geometry for public projection later.

---

## 15. Changelog Entry (Template)

Add to `CHANGELOG.md` under `Unreleased`:
```
Added: Read-only public sharing for courses via unified /courses/:id route (shareEnabled flag).
```

---

## 16. Summary

The MVP provides a controlled, minimal, safe read‑only view path with clear separation from authenticated operations. It deliberately trades off revocable rotating links and analytics in favor of speed and simplicity. The design leaves a straightforward path to evolve into a richer sharing system.

---

End of document.