# Engin CRM frontend

## Run locally

From the repository root, start the app with:

```sh
./start.sh
```

The frontend runs on port `5173`; Django runs locally on port `8000`. Vite proxies `/api` and `/media` to Django.

## Run through ngrok

1. In a separate terminal, start a tunnel and copy its hostname (without `https://`):

   ```sh
   ngrok http 5173
   ```

2. The random `*.ngrok-free.app` hostname is allowed automatically. For a custom domain, restart the app with its hostname:

   ```sh
   NGROK_HOST=your-name.ngrok-free.app ./start.sh
   ```

3. Open the `https://` forwarding URL printed by ngrok.

For custom domains, `NGROK_HOST` must match the active tunnel hostname.
