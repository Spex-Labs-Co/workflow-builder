### Follwing creds are required
BETTER_AUTH_SECRET:
required for Better Auth session signing / auth security
without it, auth/session behavior will break or be unsafe

ENCRYPTION_KEY:
used by SIM to encrypt stored sensitive values, especially environment variables / secrets


API_ENCRYPTION_KEY:
used for encrypting API keys specifically


### On server perform following to update
sudo systemctl daemon-reload
sudo systemctl enable simstudio.service sim-realtime.service
sudo systemctl enable sim-worker.service
sudo systemctl start simstudio.service sim-realtime.service
sudo systemctl start sim-worker.service
sudo nginx -t && sudo systemctl reload nginx
