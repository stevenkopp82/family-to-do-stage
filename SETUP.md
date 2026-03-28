# Family To-Do App — Setup Guide

This guide walks you through setting up Firebase with Google Sign-In and deploying to GitHub Pages.
Takes about 15–20 minutes.

---

## Step 1: Create a Firebase Project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"**
3. Name it something like `family-todo` and click Continue
4. You can disable Google Analytics (not needed) → Click **"Create project"**
5. Wait for it to provision, then click **"Continue"**

---

## Step 2: Enable Google Authentication

1. In the left sidebar, click **"Build" → "Authentication"**
2. Click **"Get started"**
3. Under the "Sign-in method" tab, click **"Google"**
4. Toggle **"Enable"** to ON
5. Enter a **Project support email** (your own email address)
6. Click **"Save"**

That's it — no passwords to manage. Anyone in your family with a Google account can sign in.

---

## Step 3: Set Up Firestore Database

1. In the left sidebar, click **"Build" → "Firestore Database"**
2. Click **"Create database"**
3. Choose **"Start in production mode"** → click Next
4. Select a location close to you (e.g., `us-east1`) → click **"Enable"**
5. Wait for it to provision

### Apply Security Rules

1. Click the **"Rules"** tab in Firestore
2. Replace everything in the editor with the contents of `firestore.rules`
3. Click **"Publish"**

These rules ensure each family can only see their own data.

---

## Step 4: Get Your Firebase Config

1. In the Firebase Console, click the **gear icon ⚙️** next to "Project Overview"
2. Select **"Project settings"**
3. Scroll down to **"Your apps"** section
4. Click the **"</>"** (Web) icon to add a web app
5. Give it a nickname like `family-todo-web` — no need to enable Firebase Hosting
6. Click **"Register app"**
7. You'll see a config block like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123"
};
```

8. Copy all of this.

---

## Step 5: Paste Config Into app.js

Open `app.js` and find the block near the top:

```js
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  ...
};
```

Replace it with your actual values from Step 4.

---

## Step 6: Deploy to GitHub Pages

Since this app uses plain HTML/CSS/JS with Firebase loaded via CDN, no build step is needed.

1. Create a new GitHub repository (e.g., `family-todo`) — make it **Public**
2. Upload all three files:
   - `index.html`
   - `style.css`
   - `app.js`
3. Go to your repo → **Settings → Pages**
4. Under "Source", select **"Deploy from a branch"**
5. Choose **"main"** branch and **"/ (root)"** folder → click **Save**
6. Wait ~1 minute, then visit `https://YOUR-USERNAME.github.io/family-todo`

---

## Step 7: Add Authorized Domains to Firebase

Google Sign-In will be blocked unless you tell Firebase your app's URL is trusted.

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Click **"Add domain"**
3. Enter: `YOUR-USERNAME.github.io`
4. Click **"Add"**

`localhost` is usually already in the list (useful for testing locally).

---

## Step 8: First-Time Use

1. Visit your GitHub Pages URL
2. Click **"Continue with Google"** — a Google sign-in popup will appear
3. After signing in, you'll be prompted once to enter your name and a family name
4. You're in! Click **"👥 Members"** to add the rest of your family

### Inviting a Second Adult (e.g., your partner)

Each new Google sign-in creates a separate family by default. The simplest way to share one family with a partner is to **share a single Google login** — create a shared family Google account (e.g. `thesmiths.family@gmail.com`) that both adults use for this app.

---

## How the App Works

### Adding Family Members
- Click **"👥 Members"** in the top right
- Add names for everyone — kids, grandparents, whoever needs tasks assigned to them
- Members don't need a login; they're just names used for task assignment
- Pick a color for each member so their avatar is easy to spot

### Managing Tasks
- **Add Task**: Click "+ Add Task" — set a title, optional due date, recurrence, and who it's for
- **Complete a Task**: Click the circle on the left
  - One-time tasks disappear when completed
  - Recurring tasks automatically re-appear on their next due date
- **Edit**: Click the ✏️ icon
- **Delete permanently**: Click the 🗑️ icon (always confirms first)

### Recurrence
When you complete a recurring task, it automatically calculates the next occurrence and reopens itself. For example:
- "Take out trash" set to **Weekly** on Monday → reappears every Monday
- To stop a recurring task permanently, delete it with the 🗑️ icon

### Sorting & Filtering
- Overdue tasks appear at the top in red
- Then tasks sorted by due date (earliest first)
- Tasks with no due date appear at the bottom
- Use the member chips at the top to filter to one person's tasks

---

## Troubleshooting

**"auth/unauthorized-domain" error on sign-in**
→ Go back to Step 7 and add your GitHub Pages domain to Firebase Authorized Domains

**Blank screen or JavaScript errors**
→ Open browser DevTools (F12) → Console — look for the specific error
→ Double-check all `firebaseConfig` values in app.js are correct

**"Permission denied" Firestore errors**
→ Make sure your Firestore security rules are published (Step 3)

**Sign-in popup is blocked**
→ Allow popups for your GitHub Pages URL in your browser settings
