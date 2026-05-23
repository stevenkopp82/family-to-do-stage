# family-to-do
Family to do list

## Testing locally

### Unit tests (logic only, no Firebase needed)

```bash
npm test
```

Runs the Jest suite in `logic.test.js`. Covers `computeNextDue`, `sortTasks`, `filterTasks`, and `timestampToLocalDate`. No browser or Firebase connection required.

To re-run automatically as you save files:

```bash
npm run test:watch
```

### Full UI (in-browser, with live Firebase)

The app is plain HTML/CSS/JS — no build step. Just serve the project root over HTTP (Firebase auth won't work over `file://`):

```bash
npx serve .
```

Then open the URL it prints (usually `http://localhost:3000`). Sign in with Google — `localhost` is pre-authorized in Firebase so auth works out of the box.

> If you don't have `serve` installed it will prompt you to install it once. Alternatively use `npx http-server` or VS Code's Live Server extension.
