# DigitalOcean Deployment

This app is ready for DigitalOcean App Platform after the code is pushed to a Git repo.

## Files Added

- `package.json` gives App Platform a Node start command.
- `.do/app.yaml.example` is a secret-free App Platform spec template.
- `/api/health` is a lightweight health check endpoint.

## Deploy Shape

1. Push this folder to GitHub or GitLab.
2. Copy `.do/app.yaml.example` to `.do/app.yaml`.
3. Replace `https://github.com/YOUR_USER/YOUR_REPO.git` with your repo clone URL.
4. If you want live AI drafts, add either `DIGITALOCEAN_INFERENCE_KEY` or `OPENAI_API_KEY` as a `SECRET` runtime env var in DigitalOcean.
5. Create the app with DigitalOcean App Platform using the spec.

Do not store DigitalOcean tokens or OpenAI keys in this repo.

## AI Drafts

The chat draft endpoint tries providers in this order:

1. DigitalOcean Serverless Inference, when `DIGITALOCEAN_INFERENCE_KEY` is set.
2. OpenAI, when `OPENAI_API_KEY` is set.
3. The built-in local fallback.

For DigitalOcean, prefer a scoped model access key if available instead of a broad account API token. The defaults are:

- `DIGITALOCEAN_INFERENCE_BASE_URL=https://inference.do-ai.run`
- `DIGITALOCEAN_INFERENCE_MODEL=mistral-3-14B`

You can change the model with `DIGITALOCEAN_INFERENCE_MODEL`.

## Droplet Script

`deploy-digitalocean-droplet.mjs` creates a Droplet directly from the local files. It reads:

- `DIGITALOCEAN_TOKEN` to create the Droplet.
- `DIGITALOCEAN_INFERENCE_KEY` optionally, to enable DigitalOcean AI chat drafts on the Droplet.
- `DIGITALOCEAN_INFERENCE_MODEL` optionally, defaulting to `mistral-3-14B`.
- `OPENAI_API_KEY` optionally, to enable live OpenAI chat drafts on the Droplet.
- `OPENAI_MODEL` optionally, defaulting to `gpt-5.2`.

The script writes runtime env vars to `/etc/neara/env` on the Droplet with `600` permissions.
