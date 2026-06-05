# Neara: Opt-In Nearby Discovery and AI-Assisted Conversation

Neara is a web prototype for meeting nearby people in a safer, more intentional way. A user shares their exact location only while visible, sees other opted-in users within a walkable radius, sends a wave, and opens a private chat only after both people say yes. The project adds a lightweight match-agent layer that turns profile answers and chat themes into broad compatibility signals, then uses an AI provider to draft low-pressure conversation starters.

## Project Submission Summary

**Project title:** Neara: Opt-In Nearby Discovery and AI-Assisted Conversation

**Project track:** Application / Product, with Automation / Agent Systems elements.

**GitHub link:** Add the public repo URL here before Gradescope submission.

**Compute / deployment:** The app can run locally with Node and has DigitalOcean deployment support. The current deployment metadata is in `digitalocean-deployment.json`.

## Problem and Insight

Nearby social discovery apps often create two problems at once: they make proximity feel useful, but they also make first contact feel awkward, unsafe, or too exposed. Neara explores a different interaction pattern:

- Location sharing is explicit, visible, and pausable.
- Conversation requires mutual opt-in.
- Matching uses broad intent and comfort signals, not just raw proximity.
- AI helps with the first-message bottleneck by drafting editable, low-pressure messages.

The core insight is that "who is nearby?" is not enough. A useful nearby app also needs to answer "should I say hello?", "what would feel comfortable?", and "how do I start without making it weird?"

## Current Progress

I built a working browser prototype with a Node backend, real map tiles, exact/demo location handling, nearby presence, waves, mutual chat, AI conversation cards, and AI-generated chat drafts. The app can be tested locally at `http://127.0.0.1:4173/`, with demo mode available through `?demo=1` so it can be shown without requesting real location.

The backend includes a match-agent schema for each user. It stores broad characteristics such as interests, social style, pace, mood, and food/drink preferences, then compares those profiles to produce compatibility scores, match explanations, and conversation starters.

## How the Product Works

1. A user opens the app and fills out a short interview profile: nearby intent, food/drink preferences, mood, and pace.
2. The app asks for location, or uses demo coordinates when `?demo=1` is present.
3. The Node server keeps an in-memory list of visible users and returns nearby opted-in people within about one mile.
4. A user sends a wave to someone nearby.
5. Chat opens only when the other person accepts the wave.
6. Once connected, the backend creates match recommendations using both users' characteristic schemas.
7. The conversation card shows AI-style topic flashcards based on the match recommendation.
8. The AI draft button calls `/api/ai/suggest-message` to generate a short editable message.

## Technical Architecture

**Frontend:** `index.html`, `styles.css`, and `app.js`

- Responsive single-page interface.
- OpenStreetMap tile rendering without an external map library.
- Exact coordinate display while visible.
- Demo mode for reproducible testing.
- Notification panel, privacy panel, nearby people list, conversation cards, and chat drawer.

**Backend:** `server.js`

- Plain Node HTTP server.
- In-memory users, waves, connections, messages, profile schemas, and vector-like dimension arrays.
- Server-sent events for live state updates.
- REST endpoints for join, heartbeat, waves, messages, match schemas, and AI drafts.
- Content Security Policy headers for safer browser execution.

**AI provider chain:**

1. DigitalOcean Serverless Inference when `DIGITALOCEAN_INFERENCE_KEY` is set.
2. OpenAI when `OPENAI_API_KEY` is set.
3. Local heuristic fallback when no external key is available.

The DigitalOcean default model is `mistral-3-14B`. OpenAI defaults to `gpt-5.2` if an OpenAI key is provided.

## Match-Agent Schema

Each user gets a broad characteristic schema built from their interview answers and their own outgoing chat messages. The schema includes:

- Interests, such as coffee, walks, food, music, art, fitness, study, and outdoors.
- Intent, such as quick hello, low pressure, and plan soon.
- Social style, such as public spot, curious, and friendly.
- Fifteen scored dimensions, including social openness, leisurely pace, spontaneous pace, reflective mood, playful mood, coffee friendliness, quiet preference, curiosity, and safety priority.
- A vector-like numeric array derived from those scored dimensions.

When two people are near each other, the backend compares their schemas, computes cosine similarity over the dimension array, finds overlapping signals, and returns a score, archetype, explanation, and conversation starters.

## Evaluation and Evidence

Validation so far focuses on whether the prototype behaves correctly end to end:

- Local smoke tests check `server.js` and `app.js` syntax.
- API tests create two demo users, send and accept a wave, verify mutual chat, and call the AI draft endpoint.
- Browser tests use demo mode to verify the welcome flow, map state, conversation card, chat drawer, and AI draft insertion.
- AI draft tests verify the app does not repeatedly send the same canned text and blocks AI follow-up generation when the current user already sent the latest message.
- CSP testing addressed an inline-script browser warning from the in-app browser environment.

The biggest evidence of progress is that the prototype moved from static mock data to a functional local service with real state transitions: join, discover, wave, accept, chat, match explanation, and AI draft.

## Limitations

- The backend state is currently in memory, so users, messages, and schemas reset when the server restarts.
- There is no production authentication yet. Demo user IDs are generated in the browser or supplied through the URL.
- Exact location is intentionally visible in this prototype, but a production version would need stronger privacy controls, HTTPS, reporting/blocking, moderation, and optional approximate-location modes.
- The current match "embedding" is a transparent scored-dimension vector, not a production vector database.
- The web prototype does not implement native BLE proximity. BLE/RSSI would require a mobile app layer.
- Remote geolocation should be served over HTTPS in production. Localhost is acceptable for browser testing.

## Future Implementation

Next I would add:

- Persistent storage for users, matches, messages, and schemas.
- Login/authentication and abuse prevention.
- HTTPS-first DigitalOcean deployment with secret-managed AI keys.
- A production database plus Redis or WebSockets for scalable realtime pairing.
- A real embedding model and vector store for richer compatibility search.
- More privacy controls: location fuzzing, time-limited visibility, block/report, and consent reminders.
- User testing with structured feedback on whether AI drafts feel helpful, safe, and natural.
- A mobile version with BLE/RSSI proximity for passive nearby detection.

## Run Locally

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4173/
```

Demo mode:

```text
http://127.0.0.1:4173/?demo=1&name=You&userId=demo-you
```

Optional AI environment variables:

```bash
export DIGITALOCEAN_INFERENCE_KEY="..."
export DIGITALOCEAN_INFERENCE_MODEL="mistral-3-14B"
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-5.2"
npm start
```

Do not commit API keys or DigitalOcean tokens to the repo.

## Deployment

See `DIGITALOCEAN.md` for DigitalOcean setup notes. The app can be deployed as a Node service on a Droplet or adapted for DigitalOcean App Platform after pushing to a Git repo.

## Video Outline

**Q1: Why build this?**

Start with the problem: nearby discovery is useful, but first contact is awkward and location privacy is sensitive. Neara explores an opt-in, mutual-consent pattern where AI helps people start a conversation without making the app feel invasive.

**Q2: How does it work?**

Show the app flow: profile interview, exact/demo location, nearby map, person card, wave request, accept, conversation card, chat drawer, and AI draft. Then explain the architecture: frontend, Node backend, in-memory realtime state, match-agent schemas, DigitalOcean/OpenAI/local AI provider chain.

**Q3: Potential use cases and impact**

Use cases include college campuses, conferences, coworking spaces, neighborhoods, festivals, and small communities where people are physically near each other but need a low-pressure way to start. The value is reducing social friction while keeping consent and privacy visible.

**Q4: What more would you add?**

Discuss persistence, auth, HTTPS deployment, stronger privacy controls, moderation, user testing, a real vector database, and a future mobile BLE layer.

## Process, Integrity, and Disclosure

This project was built iteratively with AI coding assistance. AI was used to help implement features, debug the app, write documentation, and test flows. The running product also uses AI providers for optional chat draft generation.

External sources and services:

- OpenStreetMap tiles and attribution for map imagery.
- DigitalOcean for deployment and optional Serverless Inference.
- OpenAI as an optional AI draft provider.
- Node.js built-in HTTP/server APIs.

This project was not forked from an existing app repo. The older `domain_bias_experiment.py` file is unrelated leftover coursework and is not the submitted Neara application.
