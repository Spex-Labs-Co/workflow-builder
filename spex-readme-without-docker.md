Do this on the server once. After that, pushing to `sim_v1` will update it automatically.

Assumption:
- server path will be `/home/sim`
- domain names:
  - `builder.spexlabs.co`
  - `realtime.spexlabs.co`
- branch:
  - `sim_v1`

Use Ubuntu/Debian-style commands.

**1. Install system packages**
```bash
sudo apt update
sudo apt install -y curl git nginx postgresql postgresql-contrib
curl -fsSL https://bun.sh/install | bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**2. Create DB and user**
```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE simstudio;
CREATE USER simuser WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE simstudio TO simuser;
\q
SQL
```

**3. Clone repo**
```bash
sudo mkdir -p /home/sim
sudo chown -R $USER:$USER /home/sim
git clone https://github.com/Spex-Labs-Co/workflow-builder.git /home/sim
cd /home/sim
git checkout sim_v1
```

**4. Create app env**
```bash
mkdir -p /home/sim/apps/sim
nano /home/sim/apps/sim/.env
```

Put your real values there. Minimum important ones:
```env
DATABASE_URL=postgresql://simuser:your_password_here@localhost:5432/simstudio

BETTER_AUTH_SECRET=your_random_64_hex
BETTER_AUTH_URL=https://builder.spexlabs.co
NEXT_PUBLIC_APP_URL=https://builder.spexlabs.co

ENCRYPTION_KEY=your_random_64_hex
API_ENCRYPTION_KEY=your_random_64_hex
INTERNAL_API_SECRET=your_random_64_hex

NEXT_PUBLIC_SOCKET_URL=https://realtime.spexlabs.co
SOCKET_SERVER_URL=http://127.0.0.1:3002

SPEX_API_BASE_URL=https://your-spex-api-domain
SPEX_FRONTEND_URL=https://your-spex-frontend-domain
SPEX_INTERNAL_API_KEY=your_spex_internal_api_key
SPEX_AUTH_ONLY=true
```

Generate secrets with:
```bash
openssl rand -hex 32
```

**5. Copy DB env**
```bash
cp /home/sim/apps/sim/.env /home/sim/packages/db/.env
```

**6. Install dependencies**
```bash
cd /home/sim
bun install --frozen-lockfile
```

**7. Run DB migrations**
```bash
cd /home/sim/packages/db
bun run db:migrate
```

**8. Build app**
```bash
cd /home/sim/apps/sim
bun run build
```

**9. Install systemd services**
```bash
sudo cp /home/sim/simstudio.service /etc/systemd/system/
sudo cp /home/sim/sim-realtime.service /etc/systemd/system/
sudo cp /home/sim/sim-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable simstudio.service
sudo systemctl enable sim-realtime.service
sudo systemctl enable sim-worker.service
sudo systemctl start simstudio.service
sudo systemctl start sim-realtime.service
sudo systemctl start sim-worker.service
```

**10. Install nginx config**
```bash
sudo cp /home/sim/sim.nginx /etc/nginx/sites-available/sim
sudo ln -sf /etc/nginx/sites-available/sim /etc/nginx/sites-enabled/sim
sudo nginx -t
sudo systemctl reload nginx
```

**11. Add SSL**
Use your normal cert flow. Example with certbot:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d builder.spexlabs.co -d realtime.spexlabs.co
```

**12. Set up GitHub self-hosted runner**
Go to GitHub repo:
- `workflow-builder`
- `Settings`
- `Actions`
- `Runners`
- `New self-hosted runner`

Run the exact commands GitHub gives you on the server.
Keep the runner service running on the same machine.

**13. Give runner sudo permission for service restarts**
Run:
```bash
sudo visudo
```

Add this line:
```text
ALL ALL=NOPASSWD: /bin/systemctl daemon-reload, /bin/systemctl restart simstudio.service, /bin/systemctl restart sim-realtime.service, /bin/systemctl restart sim-worker.service
```

**14. First health check**
```bash
systemctl status simstudio.service --no-pager
systemctl status sim-realtime.service --no-pager
systemctl status sim-worker.service --no-pager
curl -I http://127.0.0.1:3000
curl http://127.0.0.1:3002/health
```

**15. Future deploy**
After all this, next time just do:
```bash
git push origin sim_v1
```

That will trigger:
- `.github/workflows/deploy-spex.yml`
- server pulls latest code
- installs deps
- runs migrations
- rebuilds
- restarts services

That is the full first-time setup plus automatic update path.