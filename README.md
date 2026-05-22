# DSA Progress Tracker (GitHub Pages)

Simple static website to track DSA question progress with persistent checkbox state.

## Features
- Category-wise checklist
- Overall progress bar
- Category progress bars
- Solved today counter
- Date-wise solved tracking history
- Activity heatmap (last 12 weeks)
- Google login
- Cross-device sync using Firestore
- Progress auto-saved in browser `localStorage`
- Reset / Expand / Collapse controls

## Deploy on GitHub Pages
1. Create a new GitHub repository (for example: `dsa-progress-tracker`).
2. Copy these files to repo root:
   - `index.html`
   - `style.css`
   - `script.js`
3. Push to `main` branch.
4. In GitHub, go to **Settings → Pages**.
5. Under **Build and deployment**, choose:
   - **Source**: Deploy from a branch
   - **Branch**: `main` and folder `/ (root)`
6. Save. GitHub will provide a URL like:
   - `https://<your-username>.github.io/dsa-progress-tracker/`

## Cleaner URL setup (recommended)
If you want the cleaner root URL:
- `https://<your-username>.github.io/`

Use a **user site** repository name exactly:
- `<your-username>.github.io`

Then:
1. Create repository named exactly `<your-username>.github.io`.
2. Put `index.html`, `style.css`, `script.js` in repository root.
3. Push to `main`.
4. In **Settings → Pages**, use `main` + `/ (root)`.

Your tracker will open directly at:
- `https://<your-username>.github.io/`

## Notes
- Saved state is browser-specific (localStorage).
- If you clear browser site data, progress resets.

## Enable Google Login + Cloud Sync
1. Create a Firebase project.
2. In Firebase Console:
    - Enable **Authentication → Google** provider.
    - Enable **Firestore Database** (production or test mode).
3. Add GitHub Pages domain in Auth authorized domains:
    - `<your-username>.github.io`
4. Open [DC-apr20/leetcoder/firebase-config.js](DC-apr20/leetcoder/firebase-config.js) and fill your Firebase web config.
5. Deploy/push again.

Recommended Firestore rule (user can read/write only own doc):

```
rules_version = '2';
service cloud.firestore {
   match /databases/{database}/documents {
      match /dsaProgress/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
      }
   }
}
```
