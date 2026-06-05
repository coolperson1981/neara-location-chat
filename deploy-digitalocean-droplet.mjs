import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const token = process.env.DIGITALOCEAN_TOKEN;
if (!token) {
  throw new Error("Set DIGITALOCEAN_TOKEN in the environment before running this script.");
}

const APP_FILES = ["index.html", "styles.css", "app.js", "server.js", "package.json"];
const name = process.env.DROPLET_NAME || `neara-${Date.now()}`;
const region = process.env.DROPLET_REGION || "sfo3";
const size = process.env.DROPLET_SIZE || "s-1vcpu-1gb";
const image = process.env.DROPLET_IMAGE || "ubuntu-24-04-x64";
const openAiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.2";
const digitalOceanInferenceKey = process.env.DIGITALOCEAN_INFERENCE_KEY || "";
const digitalOceanInferenceModel = process.env.DIGITALOCEAN_INFERENCE_MODEL || "mistral-3-14B";

function bundleApp() {
  const result = spawnSync("tar", ["-czf", "-", ...APP_FILES], {
    encoding: "buffer",
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString() || "Could not create app bundle.");
  }
  return result.stdout.toString("base64");
}

function systemdEnvValue(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("$", "\\$")}"`;
}

function cloudInit(bundle) {
  const openAiEnv = openAiKey ? `OPENAI_API_KEY=${systemdEnvValue(openAiKey)}\n` : "";
  const digitalOceanInferenceEnv = digitalOceanInferenceKey ? `DIGITALOCEAN_INFERENCE_KEY=${systemdEnvValue(digitalOceanInferenceKey)}\n` : "";
  return `#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

mkdir -p /opt/neara
mkdir -p /etc/neara
cat >/tmp/neara.tgz.b64 <<'APP_BUNDLE'
${bundle}
APP_BUNDLE
base64 -d /tmp/neara.tgz.b64 >/tmp/neara.tgz
tar -xzf /tmp/neara.tgz -C /opt/neara
rm -f /tmp/neara.tgz /tmp/neara.tgz.b64

apt-get update
apt-get install -y ca-certificates curl nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

cat >/etc/neara/env <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=4173
OPENAI_MODEL=${systemdEnvValue(openAiModel)}
DIGITALOCEAN_INFERENCE_MODEL=${systemdEnvValue(digitalOceanInferenceModel)}
${openAiEnv}${digitalOceanInferenceEnv}ENV
chmod 600 /etc/neara/env

cat >/etc/systemd/system/neara.service <<'SERVICE'
[Unit]
Description=Neara location chat app
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/neara
EnvironmentFile=/etc/neara/env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/nginx/sites-available/neara <<'NGINX'
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;

  location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/neara /etc/nginx/sites-enabled/neara
nginx -t

systemctl daemon-reload
systemctl enable --now neara
systemctl restart nginx
`;
}

async function digitalOcean(path, options = {}) {
  const response = await fetch(`https://api.digitalocean.com/v2${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `DigitalOcean request failed with status ${response.status}`);
  }
  return payload;
}

function publicIp(droplet) {
  return droplet.networks?.v4?.find((network) => network.type === "public")?.ip_address || null;
}

const userData = cloudInit(bundleApp());
if (Buffer.byteLength(userData, "utf8") > 64 * 1024) {
  throw new Error(`Cloud-init user_data is ${Buffer.byteLength(userData, "utf8")} bytes, over the 64 KiB DigitalOcean limit.`);
}

console.log(`Creating DigitalOcean Droplet ${name} in ${region} using ${size}...`);
const created = await digitalOcean("/droplets", {
  method: "POST",
  body: JSON.stringify({
    name,
    region,
    size,
    image,
    user_data: userData,
    ipv6: true,
    monitoring: true,
    tags: ["neara"],
    with_droplet_agent: true,
  }),
});

const id = created.droplet.id;
let droplet = created.droplet;
let ip = publicIp(droplet);

for (let attempt = 0; attempt < 40 && !ip; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  droplet = (await digitalOcean(`/droplets/${id}`)).droplet;
  ip = publicIp(droplet);
}

const result = {
  id,
  name,
  region,
  size,
  image,
  ip,
  url: ip ? `http://${ip}/` : null,
  health: ip ? `http://${ip}/api/health` : null,
};

writeFileSync("digitalocean-deployment.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
