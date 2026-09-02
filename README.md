# NeoDove → Callyzer Middleware

A lightweight Node.js middleware that connects **NeoDove CRM** with **Callyzer**.

It receives lead and call events from NeoDove, sends lead data to Callyzer, preserves the original lead owner during call events, and safely handles multiple employees calling at the same time.

---

## Features

- Syncs new NeoDove leads to Callyzer
- Uses one webhook URL for all supported NeoDove workflows
- Supports:
  - Lead Created
  - Call Connected
  - Call Not Connected
- Creates or updates Callyzer leads
- Preserves existing Callyzer `Assign To` during call events
- Lets Callyzer handle:
  - Last Call Employee
  - Number of Attempts
  - Call Duration
  - Call Recording
- Sends optional NeoDove lead details to Callyzer custom fields
- Ignores empty optional fields
- Prevents duplicate webhook processing
- Includes a queue for simultaneous employee events
- Handles Callyzer API rate limits
- Includes health and queue-status endpoints
- Supports the older `/neodove/lead` route for compatibility

---

## Final Integration Flow

```text
NeoDove
   |
   | Lead Created
   | Call Connected
   | Call Not Connected
   v
Render Middleware
/neodove/call-sync
   |
   v
Queue
   |
   v
Callyzer API
   |
   +--> Lead Created
   |    Assign To = NeoDove Agent
   |
   +--> Call Connected / Not Connected
        Existing Assign To stays unchanged

Callyzer Biz App
   |
   +--> Last Call Employee
   +--> Call Attempts
   +--> Call Duration
   +--> Call Recording
```

---

## Assignment Logic

### New Lead

If NeoDove creates a lead assigned to Shaon:

```text
NeoDove
Assign To = Shaon

        ↓

Callyzer
Assign To = Shaon
```

### Another Employee Calls the Lead

If the lead is still owned by Shaon but Fahim calls the customer:

```text
NeoDove Owner = Shaon
Caller = Fahim

        ↓

Callyzer

Assign To = Shaon
Last Call Employee = Fahim
```

The middleware does **not** change the Callyzer owner during call events.

> Lead reassignment from NeoDove is intentionally not synced in the current version.

---

## Tech Stack

- Node.js
- Express
- Helmet
- Callyzer API v2.2
- NeoDove Webhooks
- Render
- GitHub

---

## Project Structure

```text
neodove-callyzer-middleware/
│
├── server.js
├── package.json
├── package-lock.json
├── .env
├── .gitignore
└── README.md
```

---

## Environment Variables

Create a `.env` file:

```env
CALLYZER_BASE_URL=https://sandbox.api.callyzer.co/api/v2.2
CALLYZER_API_KEY=YOUR_CALLYZER_API_KEY
NEODOVE_WEBHOOK_SECRET=YOUR_NEO_DOVE_WEBHOOK_SECRET
```

For production, replace the sandbox Callyzer URL and API key with the production values provided by Callyzer.

### Important

Never commit `.env` to GitHub.

Your `.gitignore` should contain:

```gitignore
node_modules/
.env
```

---

## Install

Clone the repository:

```bash
git clone https://github.com/shaon05/neodove-callyzer-middleware.git
```

Open the project:

```bash
cd neodove-callyzer-middleware
```

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm start
```

For development:

```bash
npm run dev
```

---

## NeoDove Webhook URL

Use the same middleware URL for all three NeoDove workflows:

```text
https://neodove-callyzer-middleware.onrender.com/neodove/call-sync
```

### Workflow 1 — Lead Created

```text
Event:
Lead Created

Method:
POST

URL:
https://neodove-callyzer-middleware.onrender.com/neodove/call-sync
```

### Workflow 2 — Call Connected

```text
Event:
Call Connected

Method:
POST

URL:
https://neodove-callyzer-middleware.onrender.com/neodove/call-sync
```

### Workflow 3 — Call Not Connected

```text
Event:
Call Not Connected

Method:
POST

URL:
https://neodove-callyzer-middleware.onrender.com/neodove/call-sync
```

For all three workflows, use:

```text
Send All Data
```

Headers:

```text
Content-Type: application/json
X-Webhook-Secret: YOUR_NEO_DOVE_WEBHOOK_SECRET
```

---

## Event Detection

The middleware detects the NeoDove event using `call_connected`.

```text
call_connected = null
→ Lead Created

call_connected = true
→ Call Connected

call_connected = false
→ Call Not Connected
```

This allows all three workflows to use the same endpoint.

---

## Callyzer Lead Capture

The middleware sends leads using:

```text
POST /lead/capture
```

Example structure:

```json
{
  "leads": [
    {
      "first_name": "Zahid",
      "contact_numbers": [
        "91-8509074960"
      ]
    }
  ],
  "assignment": {
    "strategy": "Assign to All Selected",
    "emp_numbers": [
      "91-9933407752"
    ]
  },
  "existing_lead": {
    "lead_details": "overwrite",
    "assignee": "ignore",
    "lead_tags": "ignore"
  },
  "is_map_existing_call_logs": true
}
```

For a new lead, the middleware can set the Callyzer assignment from the NeoDove agent.

For call events, the existing Callyzer assignment is preserved.

---

## Callyzer Custom Fields

The middleware currently supports these Callyzer dynamic fields:

| Field | Callyzer Field ID |
|---|---|
| Email | `InputBox1787666201411` |
| Address | `InputBox1787666201414` |
| City | `InputBox1787666201418` |
| State | `InputBox1787666201420` |
| Zipcode | `InputBox1787666201423` |
| Description | `InputBox1787666201429` |
| NeoDove Lead ID | `InputBox1788251139587` |
| NeoDove Campaign Name | `InputBox1788251139595` |
| NeoDove Lead Status | `InputBox1788251139603` |
| NeoDove Agent Name | `InputBox1788251139614` |
| NeoDove Agent Number | `InputBox1788251139623` |

Optional fields are only sent when NeoDove provides a non-empty value.

---

## Multi-User Queue

Callyzer API requests are rate-limited.

The middleware therefore queues events instead of sending every request at the same time.

Example:

```text
Shaon calls
Fahim calls
Soma calls
Raj calls
        ↓
Render receives all events
        ↓
Queue
        ↓
Callyzer processes safely one-by-one
```

This helps when multiple employees make calls at nearly the same time.

The webhook responds to NeoDove immediately after adding the event to the queue.

---

## Health Check

Main health endpoint:

```text
https://neodove-callyzer-middleware.onrender.com/
```

Queue/debug endpoint:

```text
https://neodove-callyzer-middleware.onrender.com/health
```

Example:

```json
{
  "success": true,
  "environment": "sandbox",
  "queue": {
    "waiting": 0,
    "workerRunning": false
  }
}
```

The `/health` endpoint also shows:

- Accepted jobs
- Completed jobs
- Failed jobs
- Duplicate events
- Ignored events
- Recent failed jobs

---

## Deployment on Render

Push changes to GitHub:

```bash
git add .
git commit -m "Update NeoDove Callyzer middleware"
git push origin main
```

Render automatically redeploys when connected to the GitHub repository.

Recommended Render settings:

```text
Build Command:
npm install

Start Command:
npm start
```

Add the environment variables from the `.env` section in:

```text
Render
→ Service
→ Environment
```

---

## Testing

### Test 1 — Lead Created

1. Create a new lead in NeoDove.
2. Assign it to an employee.
3. Confirm the Lead Created workflow runs.
4. Open Callyzer.
5. Confirm the lead is created.
6. Confirm `Assign To` matches the NeoDove employee.

### Test 2 — Call Connected

1. Call the lead from an employee phone running Callyzer Biz.
2. Dispose/update the call in NeoDove.
3. Confirm the Call Connected workflow runs.
4. Check Callyzer.

Expected:

```text
Assign To
→ stays unchanged

Last Call Employee
→ employee who actually called

No of Attempts
→ increases

Duration
→ appears

Recording
→ appears when synced by Callyzer Biz
```

### Test 3 — Different Employee Calls

Example:

```text
Lead Owner = Shaon
Caller = Fahim
```

Expected Callyzer result:

```text
Assign To = Shaon
Last Call Employee = Fahim
```

---

## Callyzer Biz Requirements

The employee phone must have Callyzer Biz configured correctly.

Make sure:

- Callyzer Biz is logged in
- Correct SIM is selected
- Phone permissions are allowed
- Background activity is allowed
- AutoStart is enabled where required
- Battery optimization is disabled/restricted appropriately
- Call recording permission/location is configured

The middleware does not upload call recordings itself.

Callyzer Biz is responsible for syncing:

```text
Call Logs
Recordings
Last Call Employee
Duration
Attempts
```

---

## Known Limitation

The current NeoDove workflow setup only provides:

```text
Lead Created
Call Connected
Call Not Connected
```

Therefore NeoDove lead reassignment is **not synchronized** to Callyzer in this version.

The integration intentionally preserves the original Callyzer owner during call events.

---

## Security

Before using the integration in production:

- Rotate any API keys used during development/testing
- Rotate the NeoDove webhook secret
- Never commit `.env`
- Keep Callyzer API keys only in Render environment variables
- Use HTTPS only
- Regularly review Render logs
- Remove unused debug routes
- Restrict access to production credentials

---

## Current Status

The integration has been tested successfully for:

```text
NeoDove Lead Created         ✅
NeoDove Call Connected       ✅
NeoDove Call Not Connected   ✅
Callyzer Lead Creation       ✅
Callyzer Lead Update         ✅
Lead Assignment              ✅
Assignment Preservation      ✅
Last Call Employee           ✅
Call Attempts                ✅
Call Duration                ✅
Call Recording               ✅
Multiple Employee Events     ✅
API Rate-Limit Queue         ✅
```

---

## Repository

```text
https://github.com/shaon05/neodove-callyzer-middleware
```

---

## Middleware URL

```text
https://neodove-callyzer-middleware.onrender.com
```

---

## License

Internal integration project. Add an appropriate license before public distribution.
