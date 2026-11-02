# Sharing the budget between two phones (one-time, ~10 minutes)

The app works on its own without any of this (data stays on that one phone). Do this once to make
you and your wife see the same budget live. It uses Firebase's free tier.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. **Add project** → name it `simple-budget` → turn Google Analytics **off** → Create.

## 2. Turn on the three pieces
1. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
2. **Build → Firestore Database → Create database** → pick a nearby region → **Start in production mode**.
3. In Firestore, open the **Rules** tab, replace everything with the rules below, and **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 3. Connect your phone
The Firebase config is already built into the app, so there's nothing to copy or paste.
1. Open Simple Budget → **Settings → Share with your wife → Set up sync**.
2. Enter a **household email and password** (any email; you'll both use the same one) → **Create household**.
3. If receipts are already on the phone it asks whether to upload them — say yes.

## 4. Connect your wife's phone
1. Open the app → **Settings → Set up sync**.
2. Enter the **same** email and password → **Sign in** (not Create).

Your Claude API key is stored in the shared settings, so she doesn't need to enter it.
