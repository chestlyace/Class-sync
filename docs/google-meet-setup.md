# Google Meet classrooms

A lecturer can create one Google Meet room per course (the course's "classroom") from the course settings page. Clasync creates the room in the **lecturer's own Google account** with the Google Meet REST API, so the lecturer owns the room and is always the host. The room is set so that everyone knocks: nobody walks in with a shared address, and the lecturer admits people in Meet. Students never see the address on Clasync's pages; they reach the room only through the signed-in Join button.

Pasting a Meet link per class stays available as a fallback (no Google account, or before Google approves the permission).

## Google Cloud, once per installation

Use the existing project `classync-5ed54` and its existing Google sign-in client. No new client and no new secret are needed, and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` stay as they are.

1. In APIs and Services, enable the **Google Meet REST API**.
2. In Google Auth Platform, open the consent screen's data access (scopes) and add:
   - `https://www.googleapis.com/auth/meetings.space.created` (sensitive: lets Clasync create Meet rooms and manage only the rooms it created)
   - `https://www.googleapis.com/auth/meetings.space.settings` (not sensitive: lets Clasync set the room's access type)
3. Leave the app published ("In production").

Clasync asks for nothing else: no calendar, Drive or Gmail access.

## App switch

The feature is controlled by one variable, `MEET_CLASSROOM`:

| Value | Who sees "Create the classroom" |
| --- | --- |
| `off` (default, also any unknown value) | Nobody. The Online forms ask for a pasted Meet link. |
| `admins` | Only admins (`ADMIN_EMAILS`). Use this for testing. |
| `everyone` | Every lecturer. |

Rollout:

1. After the release: `heroku config:set -a clasync MEET_CLASSROOM=admins`.
2. Test with your own Gmail on a test course: open the course settings, press **Create the classroom**, accept Google's consent screen (the two scopes), come back, and check the room exists. With a second account, press Join and check that you have to knock.
3. Record the demo video and submit the app for verification (script and justification text are in the local notes, `docs/superpowers/specs/2026-11-25-meet-classroom-verification.md`).
4. When Google approves: `heroku config:set -a clasync MEET_CLASSROOM=everyone`.

## Before Google verifies the app

Because `meetings.space.created` is a sensitive scope, until Google verifies the app:

- Lecturers see Google's "Google hasn't verified this app" screen and must choose Advanced, then continue.
- Google caps the number of users who can grant the permission at 100.

Both go away once verification is approved.

## Good to know

- **Stored keys.** The Google keys Clasync stores for a lecturer are encrypted with `BETTER_AUTH_SECRET`. Rotating that secret makes the stored keys unreadable, so lecturers have to reconnect Google (the classroom button asks them to).
- **"Everyone knocks" on a personal account.** Clasync creates the room with access type `RESTRICTED`. If Google refuses that setting for a lecturer's account (some personal accounts), Clasync creates the room anyway and the lecturer sees a tip: turn off "Quick access" in Meet's host controls. The course settings page keeps showing the tip until then.
- **Deleting a course** does not delete the Google room (the Meet API cannot delete spaces). It stays, unused, in the lecturer's Google account.
- **No Google call at read time.** Clasync only calls Google when a lecturer presses Create the classroom (or ticks the classroom option in a form). Page loads, the Join route and every student action never call Google.

## Database

Migration `0029_online_classes_meet.sql` adds the online-class columns and `online_class_join`. Migration `0030` adds the per-course classroom and drops the earlier per-class generated-link cache. Both are applied by `npm run db:migrate` (on Heroku, in the release phase).

## What users see

- Lecturers: the Online tick in the timetable, make-up, "Move online" and course-creation forms offers **Use this course's classroom** (default when the course has one) or **Paste a Meet link**. The classroom is created from the course settings page, or from a form when the permission is already granted.
- The lecturer's class page shows the room address.
- Students are given the room only through the signed-in Join button, from 15 minutes before the class until it ends, and knock to be admitted.
