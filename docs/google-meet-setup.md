# Automatic Google Meet links

Clasync can create one Google Meet link per dated online class. It uses a **service account on its own Google Calendar** — it does not impersonate a Workspace user and does not need anyone's personal Google account. Until the variables below are set, the Online forms ask the lecturer to paste a Meet link, and a join attempt for a generated link redirects to the dashboard with a short notice.

## Google Cloud, once per installation

1. Create (or choose) a Google Cloud project and enable the **Google Calendar API**.
2. Create a **service account** in that project. Download its JSON key and keep it private.
3. Note the `client_email` and `private_key` from the JSON. The calendar is the service account's own primary calendar; `GOOGLE_CALENDAR_ID` can be left unset.
4. Optionally share that calendar with a timetable manager's Google account if a human needs to inspect the events. Clasync itself only needs the service account.

No OAuth consent screen, domain-wide delegation or Gmail/Workspace admin step is required. The lecturer is added to the Calendar event as an attendee, but `sendUpdates: 'none'` tells Google not to email them; Clasync sends its own class notices. Students are never added to the event.

## App variables

Set these on the host that runs the app (for Heroku: `heroku config:set ...`). Keep the private key out of source control.

| Variable | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The service account's `client_email`. |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Its `private_key`. Real newlines work; escaped `\n` also works. |
| `GOOGLE_CALENDAR_ID` | Optional. Defaults to `primary` (the service account's own calendar). |

The feature is disabled unless the email and key are both present. Restart the app after changing them.

## Database

Deploy migration `0029_online_classes_meet.sql` with `npm run db:migrate`. It adds `meeting_url` and `auto_meet` to `class_slot`/`class_extra`, the `online_class_join` table and the `class_meeting` cache. Each generated link is cached by occurrence key; changing a class's time, weekday, term or online mode clears the affected future cache rows so the next read creates a fresh event.

## What users see

- The Online tick in the timetable, make-up, "Move online", and course-creation forms offers **Generate a Meet link for each class** when configured. Otherwise it asks for a pasted link.
- Course creation can also tick **Create first online slot (Recommended)** and supply a weekday, time and term: the course and its first weekly class are saved together.
- Generated links are created on first need and then reused. The course owner sees the link on their class page; students only receive it through the signed-in join route, from 15 minutes before the class until it ends.
