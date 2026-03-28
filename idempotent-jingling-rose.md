# Plan: Stage / Live Deployment Split

## Context
All changes currently go live immediately on push to `main`. The goal is a staging environment to test changes before the family sees them. The app is plain HTML/CSS/JS with no build tools, deployed to GitHub Pages from `main`. Firebase handles auth and data. The Android app is built via Capacitor from the `www/` folder and only needs to track the live environment.

---

---

## Environments

| | Stage | Live |
|---|---|---|
| **Branch** | `stage` | `main` |
| **URL** | `stevenkopp82.github.io/family-to-do-stage` | `stevenkopp82.github.io/family-to-do` |
| **Firebase project** | `family-to-do-stage` (new) | `family-to-do-list-33ffa` (existing) |
| **Data** | Isolated test data | Real family data |
| **Android APK** | ❌ not built from stage | ✅ always built from `main` |
| **Who uses it** | You (testing) | Your family |

---

## Why a Separate Firebase Project for Stage?

Without it, test families/members/tasks pollute your family's live data. A separate project is free at this scale, and copying the Firestore security rules takes 2 minutes.

---

## Approach: Two Branches + GitHub Actions

- **`stage` branch** auto-deploys to a second GitHub repo (`family-to-do-stage`) via GitHub Actions on every push
- **`main` branch** auto-deploys to the existing live GitHub Pages (already works — push to main = live)
- The only file that differs between branches is the `firebaseConfig` block in `app.js`
- When promoting stage → live: `git merge stage` then restore `app.js` Firebase config on `main`

---

## Implementation Steps

### Step 1: Create the staging Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → Add project → name it `family-to-do-stage`
2. Enable **Authentication → Google sign-in**
3. Add a **web app** (name: "Family To-Do Stage") → copy the `firebaseConfig` object shown
4. Create a **Firestore database** (production mode) → paste your existing security rules from the live project
5. In Authentication → Settings → **Authorized domains** → add `stevenkopp82.github.io`

### Step 2: Create the staging GitHub repo
1. On GitHub, create a new **public** repo named `family-to-do-stage`
2. Settings → Pages → Deploy from branch → `main`, folder `/`
3. The staging URL will be: `https://stevenkopp82.github.io/family-to-do-stage`

### Step 3: Create a GitHub Personal Access Token
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token
2. Name: `STAGE_DEPLOY_TOKEN`, scope: `repo`
3. In your main `family-to-do` repo → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `STAGE_DEPLOY_TOKEN`, Value: the token

### Step 4: Create the `stage` branch locally
```bash
git checkout -b stage
git push -u origin stage
```

### Step 5: Update `app.js` on the `stage` branch
Replace the `firebaseConfig` block (`app.js` lines ~30-37) with the config from your new staging Firebase project.

### Step 6: Update the version badge in `index.html`
Change the version badge to visually flag the stage environment — so you always know which you're looking at:
```html
<div id="version-badge" style="color:#e67e22;font-weight:bold">⚠ STAGE</div>
```
(On `main`, keep the existing `vYYYYMMDD.N` format.)

### Step 7: Create the GitHub Actions workflow
Create `.github/workflows/deploy-stage.yml` **on the `stage` branch**:
```yaml
name: Deploy to Staging

on:
  push:
    branches: [ stage ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Push to staging repo
        uses: cpina/github-action-push-to-another-repository@v1.7.2
        env:
          API_TOKEN_GITHUB: ${{ secrets.STAGE_DEPLOY_TOKEN }}
        with:
          source-directory: '.'
          destination-github-username: 'stevenkopp82'
          destination-repository-name: 'family-to-do-stage'
          user-email: stevenkopp82@gmail.com
          target-branch: main
          exclude-paths: |
            android
            node_modules
            www
```

### Step 8: Update `www/` copy script to always use live config
The `cap:prepare` npm script and manual sync should only ever run from `main`. No changes needed — just make it a habit.

---

## Day-to-Day Workflow

```
Edit code on stage branch
  → git push origin stage
    → GitHub Actions deploys to stevenkopp82.github.io/family-to-do-stage (~60 sec)
      → Test there
        → When ready to promote:
            git checkout main
            git merge stage --no-commit
            git checkout stage -- .github/workflows/  # keep workflow on stage only if desired
            # IMPORTANT: restore live Firebase config in app.js
            # IMPORTANT: restore version badge in index.html
            git commit -m "promote: [description]"
            git push origin main
```

---

## Files Changed

| File | Branch | Change |
|---|---|---|
| `app.js` | `stage` | Replace `firebaseConfig` with staging Firebase credentials |
| `index.html` | `stage` | Change version badge to "⚠ STAGE" |
| `.github/workflows/deploy-stage.yml` | `stage` | New file — auto-deploys to staging repo on push |

**No changes to `main` branch** — live app is untouched until you deliberately promote.

---

## Verification
1. Push a small visible change to `stage` → confirm it appears at `stevenkopp82.github.io/family-to-do-stage` within ~90 seconds
2. Sign in at the staging URL → confirm it uses the staging Firebase (different data, no existing families)
3. Confirm `stevenkopp82.github.io/family-to-do` (live) is unchanged
4. Test the full flow on stage (create family, add member, invite link) before promoting


## Original Android Plan (preserved below)
---

## Approach: Capacitor with `@capacitor-firebase/authentication`

**Why Capacitor:**
- Wraps existing HTML/CSS/JS with no build step required
- `webDir: "."` points to the project root — Capacitor serves files as-is
- Web app on GitHub Pages is completely unaffected
- The only code change is a runtime conditional in `signInWithGoogle`

**Why `@capacitor-firebase/authentication`:**
- `signInWithPopup` is blocked in Android WebViews
- This plugin uses the native Android Google Sign-In SDK
- Returns an idToken → converted to a Firebase credential via `signInWithCredential`
- Your existing `onAuthStateChanged` listener fires as usual — zero other changes needed

---

## Prerequisites (User Must Install)

- **Android Studio** (includes JDK 17 and Android SDK)
- Set `ANDROID_HOME` environment variable (Android Studio prompts for this)
- **Node.js 18+** (already present — has Jest)

---

## Step 1: Firebase Console (Do First)

1. Open [console.firebase.google.com](https://console.firebase.google.com) → `family-to-do-list-33ffa`
2. Gear → Project Settings → "Your apps" → Add Android app
   - Package name: `com.familytodo.app`
   - Skip SHA-1 for now (add it in Step 5)
3. Download `google-services.json` — save it for Step 5

---

## Step 2: Install npm Packages

```bash
npm install @capacitor/core @capacitor/android @capacitor-firebase/authentication
npm install --save-dev @capacitor/cli
```

---

## Step 3: Initialize Capacitor

```bash
npx cap init "Family To-Do" "com.familytodo.app" --web-dir "."
npx cap add android
```

Edit the generated `capacitor.config.json` to add the plugin block:

```json
{
  "appId": "com.familytodo.app",
  "appName": "Family To-Do",
  "webDir": ".",
  "plugins": {
    "FirebaseAuthentication": {
      "skipNativeAuth": false,
      "providers": ["google.com"]
    }
  }
}
```

Add `android/` to `.gitignore` (it's large and regenerable).

---

## Step 4: Modify `app.js` — Two Changes

### Change 1: Add `signInWithCredential` to Firebase auth import

**File:** `app.js` (top imports, ~line 10)

Add `signInWithCredential` alongside existing imports:
```javascript
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,   // ADD THIS
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
```

### Change 2: Replace `signInWithGoogle` function (~line 252)

```javascript
window.signInWithGoogle = async function () {
  clearAuthError();
  try {
    const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform());

    if (isCapacitor) {
      // Native Android: use Capacitor Firebase Auth plugin
      const { FirebaseAuthentication } = window.Capacitor.Plugins;
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(
        result.credential.idToken,
        result.credential.accessToken ?? null
      );
      await signInWithCredential(auth, credential);
    } else {
      // Web: existing popup flow unchanged
      await signInWithPopup(auth, googleProvider);
    }
  } catch (e) {
    const cancelCodes = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];
    if (!cancelCodes.includes(e.code)) {
      showAuthError("Sign-in failed. Please try again.");
    }
  }
};
```

### Change 3: Fix invite link URL (~line 892)

Inside the WebView, `window.location.origin` becomes `capacitor://localhost` — unusable in invite links. Fix by hardcoding the base URL:

```javascript
// Before:
const link = familyInviteCode
  ? `${window.location.origin}${window.location.pathname}?invite=${familyInviteCode}`
  : "";

// After:
const BASE_URL = "https://stevenkopp82.github.io/family-to-do/";
const link = familyInviteCode ? `${BASE_URL}?invite=${familyInviteCode}` : "";
```

Apply the same `BASE_URL` wherever `window.location.origin` is used for invite links.

---

## Step 5: Register SHA-1 in Firebase and Add `google-services.json`

**Get the debug keystore SHA-1 (in Git Bash):**
```bash
keytool -list -v \
  -keystore ~/.android/debug.keystore \
  -alias androiddebugkey \
  -storepass android -keypass android
```

Copy the SHA1 value → Firebase Console → Your Android app → "Add fingerprint".

**Place `google-services.json`:**
```
android/app/google-services.json
```

---

## Step 6: Sync and Open in Android Studio

```bash
npx cap sync android
npx cap open android
```

In Android Studio, let Gradle sync complete. Then run on emulator or device.

**Verify `android/app/build.gradle` has** (Capacitor sync usually handles this):
```groovy
implementation platform('com.google.firebase:firebase-bom:33.0.0')
implementation 'com.google.firebase:firebase-auth'
implementation 'com.google.android.gms:play-services-auth:21.0.0'
```

And at the bottom of `android/app/build.gradle`:
```groovy
apply plugin: 'com.google.gms.google-services'
```

---

## Step 7: Build the APK

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

Side-load on Android: transfer APK to phone → enable "Install unknown apps" in Settings → open APK.

---

## Files Modified / Created

| File | Action |
|------|--------|
| `app.js` | Modify: add `signInWithCredential` import, replace `signInWithGoogle`, fix invite URL |
| `capacitor.config.json` | Create (via `npx cap init`) |
| `android/` | Create (via `npx cap add android`) — do not commit |
| `android/app/google-services.json` | Copy manually from Firebase Console |
| `.gitignore` | Add `android/` |
| `package.json` | Updated by npm install |

**No changes to `index.html` or `style.css`.**

---

## Web App Compatibility

The GitHub Pages web app is **completely unaffected**:
- `window.Capacitor` is never defined in browsers → popup path runs as before
- GitHub Pages deployment workflow unchanged (push to main)
- After any web file change, run `npx cap sync android` and rebuild the APK for updated Android build

---

## Verification

1. **Web app:** Open `stevenkopp82.github.io/family-to-do` in a browser → Google Sign-In popup works
2. **Android app:** Install APK → tap "Continue with Google" → native account picker appears → sign in completes → family tasks load
3. **Real-time sync:** Create a task in the web app → verify it appears in the Android app within seconds (Firestore onSnapshot)
4. **Invite links:** Generate invite link in Android app → verify it produces a `stevenkopp82.github.io` URL (not `capacitor://localhost`)
