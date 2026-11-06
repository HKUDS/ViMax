# ViMax Web

The Web workspace uses the existing ViMax agent loop and JSONL event stream. It does not implement workflow decisions in the browser.

From the `ViMax` repository root, create the private local agent configuration once:

```bash
cp configs/agent.example.yaml configs/agent.local.yaml
```

```bash
cd web
npm install
npm run dev
```

Or from the repository root:

```bash
./vimax web
```

The default address is `http://127.0.0.1:4173`. Override it with `VIMAX_WEB_HOST` and `VIMAX_WEB_PORT`.

Production mode:

```bash
cd web
npm run build
cd ..
./vimax web start
```

Agent credentials continue to come from ViMax environment variables or `configs/agent.local.yaml`.
